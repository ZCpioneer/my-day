import { debugLog } from "@/debug/log";
import { maskKey } from "@/keys";
import { createSseParser } from "./sse";

const CHAT_URL = "https://api.deepseek.com/chat/completions";

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ApiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: ApiMessage[];
  tools: ToolDef[];
  tool_choice?: "auto";
  stream: false;
  thinking?: { type: "disabled" };
}

/** 流式请求：除 stream 外字段与非流式一致。 */
export type ChatCompletionStreamRequest = Omit<ChatCompletionRequest, "stream"> & { stream: true };

export interface ChatCompletionResponse {
  content: string | null;
  tool_calls: ToolCall[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public userMessage: string,
  ) {
    super(message);
  }
}

export type PostJson = (
  url: string,
  headers: Record<string, string>,
  body: unknown,
) => Promise<{ status: number; json: unknown }>;

export function userMessageForStatus(status: number): string {
  if (status === 401 || status === 402 || status === 403) return "Key 不对或没有额度";
  if (status === 0) return "现在没网，过一会儿再聊。待办还可以勾";
  return "模型这轮没回上，再说一次";
}

function rawErrorMessage(json: unknown): string {
  if (json && typeof json === "object") {
    const err = (json as { error?: { message?: unknown } }).error;
    if (err && typeof err.message === "string") return err.message;
  }
  try {
    return JSON.stringify(json);
  } catch {
    return String(json);
  }
}

export async function chatCompletions(args: {
  apiKey: string;
  request: ChatCompletionRequest;
  postJson: PostJson;
}): Promise<ChatCompletionResponse> {
  const { apiKey, request, postJson } = args;
  const masked = maskKey(apiKey);
  const started = Date.now();

  debugLog.push({
    event: "http_start",
    detail: masked,
    model: request.model,
  });

  const body: ChatCompletionRequest = {
    ...request,
    thinking: { type: "disabled" },
  };

  const { status, json } = await postJson(
    CHAT_URL,
    {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  );

  const durationMs = Date.now() - started;

  if (status < 200 || status >= 300) {
    const raw = rawErrorMessage(json);
    debugLog.push({
      event: "http_fail",
      detail: raw,
      status,
      durationMs,
      model: request.model,
    });
    throw new ApiError(raw, status, userMessageForStatus(status));
  }

  const choice = (json as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> })
    ?.choices?.[0];
  const message = choice?.message;
  const content = message?.content ?? null;
  const tool_calls = message?.tool_calls ?? [];

  debugLog.push({
    event: "http_ok",
    detail: masked,
    status,
    durationMs,
    model: request.model,
  });

  return { content, tool_calls };
}

/** 流式响应里的增量片段（SSE 每个事件都是这种 JSON）。 */
interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

/**
 * 流式版聊天补全：请求带 stream: true，逐事件读 SSE。
 * content 每次变长就用「到目前为止的全文」回调 onText；
 * tool_calls 按 index 分片累积（id / function.name / function.arguments 都是碎片到的，拼起来才是完整的）。
 * 返回与 chatCompletions 同形，调用方不用区分是不是流式。
 *
 * 不走 PostJson 抽象：那个抽象是一次性返回完整 JSON 的，拿不到响应体的 ReadableStream；
 * 且 DeepSeek 已全量放开 CORS，原生 WebView 与浏览器都能裸 fetch 直连，这里直接用 fetch。
 */
export async function chatCompletionsStream(args: {
  apiKey: string;
  request: ChatCompletionStreamRequest;
  onText: (accumulated: string) => void;
}): Promise<ChatCompletionResponse> {
  const { apiKey, request, onText } = args;
  const masked = maskKey(apiKey);
  const started = Date.now();

  debugLog.push({ event: "http_start", detail: masked, model: request.model });

  const body: ChatCompletionStreamRequest = {
    ...request,
    thinking: { type: "disabled" },
  };

  let res: Response;
  try {
    res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch 本身reject = 网络层失败，与非流式的 status 0 对齐
    const durationMs = Date.now() - started;
    debugLog.push({ event: "http_fail", detail: "网络请求没发出去", status: 0, durationMs, model: request.model });
    throw new ApiError("network error", 0, userMessageForStatus(0));
  }

  if (!res.ok || !res.body) {
    const durationMs = Date.now() - started;
    const status = res.ok ? 0 : res.status;
    const json = await res.json().catch(() => ({}));
    const raw = rawErrorMessage(json);
    debugLog.push({ event: "http_fail", detail: raw, status, durationMs, model: request.model });
    throw new ApiError(raw, status, userMessageForStatus(status));
  }

  const parser = createSseParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  // index → 拼到一半的 tool_call；DeepSeek 同一轮可能并行多个 tool_call，用 index 区分
  const toolParts = new Map<number, { id: string; name: string; args: string }>();

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const events = parser.feed(decoder.decode(value, { stream: true }));
      let finished = false;
      for (const payload of events) {
        if (payload === "[DONE]") {
          finished = true;
          break;
        }
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          // 完整事件但 JSON 坏了：跳过这条，别毁掉整轮
          continue;
        }
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
          onText(content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const part of delta.tool_calls) {
            const index = typeof part.index === "number" ? part.index : 0;
            const acc = toolParts.get(index) ?? { id: "", name: "", args: "" };
            if (typeof part.id === "string") acc.id += part.id;
            if (typeof part.function?.name === "string") acc.name += part.function.name;
            if (typeof part.function?.arguments === "string") acc.args += part.function.arguments;
            toolParts.set(index, acc);
          }
        }
      }
      if (finished) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // 流读到一半断了：按没网处理，已流出的半截文本不落库（调用方整体报错）
    const durationMs = Date.now() - started;
    debugLog.push({ event: "http_fail", detail: "流读到一半断了", status: 0, durationMs, model: request.model });
    throw new ApiError("stream interrupted", 0, userMessageForStatus(0));
  }

  const tool_calls: ToolCall[] = [...toolParts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, acc]) => ({
      id: acc.id,
      type: "function" as const,
      function: { name: acc.name, arguments: acc.args },
    }));

  debugLog.push({
    event: "http_ok",
    detail: masked,
    status: 200,
    durationMs: Date.now() - started,
    model: request.model,
  });

  return { content: content || null, tool_calls };
}
