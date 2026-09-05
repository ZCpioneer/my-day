import { debugLog } from "@/debug/log";
import { maskKey } from "@/keys";

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
}

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

  const { status, json } = await postJson(
    CHAT_URL,
    {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    request,
  );

  const durationMs = Date.now() - started;

  if (status < 200 || status >= 300) {
    const raw = rawErrorMessage(json);
    debugLog.push({
      event: "http_fail",
      detail: masked,
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
