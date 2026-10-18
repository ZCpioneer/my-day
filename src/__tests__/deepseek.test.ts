import { describe, it, expect, afterEach, vi } from "vitest";
import { chatCompletions, chatCompletionsStream, userMessageForStatus, ApiError } from "@/api/deepseek";
import { debugLog } from "@/debug/log";

describe("userMessageForStatus", () => {
  it("maps 401", () => {
    expect(userMessageForStatus(401)).toBe("Key 不对或没有额度");
  });
});

describe("chatCompletions", () => {
  it("posts to official URL and logs", async () => {
    debugLog.clear();
    const postJson = async (url: string, headers: Record<string, string>, body: unknown) => {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(headers.Authorization).toBe("Bearer sk-test");
      expect((body as { stream: boolean }).stream).toBe(false);
      return {
        status: 200,
        json: {
          choices: [{ message: { content: "早。", tool_calls: undefined } }],
        },
      };
    };
    const res = await chatCompletions({
      apiKey: "sk-test",
      request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: false },
      postJson,
    });
    expect(res.content).toBe("早。");
    expect(debugLog.entries.some((e) => e.event === "http_ok")).toBe(true);
    expect(debugLog.toText()).not.toContain("sk-test");
  });

  it("posts thinking disabled on every request", async () => {
    const postJson = async (_url: string, _headers: Record<string, string>, body: unknown) => {
      expect(body).toMatchObject({ thinking: { type: "disabled" } });
      return {
        status: 200,
        json: { choices: [{ message: { content: "早。" } }] },
      };
    };
    await chatCompletions({
      apiKey: "sk-test",
      request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: false },
      postJson,
    });
  });

  it("throws ApiError on 401", async () => {
    debugLog.clear();
    const postJson = async () => ({ status: 401, json: { error: { message: "invalid" } } });
    await expect(
      chatCompletions({
        apiKey: "sk-bad",
        request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: false },
        postJson,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    const fail = debugLog.entries.find((e) => e.event === "http_fail");
    expect(fail).toBeTruthy();
    expect(fail?.detail).toBe("invalid");
    expect(fail?.status).toBe(401);
    expect(fail?.model).toBe("deepseek-v4-flash");
    expect(typeof fail?.durationMs).toBe("number");
    expect(debugLog.toText()).not.toContain("sk-bad");
  });

  it("http_fail detail is clipped error text not the masked key", async () => {
    debugLog.clear();
    const raw = `upstream error ${"x".repeat(600)}`;
    const postJson = async () => ({ status: 500, json: { error: { message: raw } } });
    await expect(
      chatCompletions({
        apiKey: "sk-secret-key",
        request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: false },
        postJson,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    const fail = debugLog.entries.find((e) => e.event === "http_fail");
    expect(fail?.detail).toBe(raw.slice(0, 500));
    expect(fail?.detail).not.toContain("sk-s");
    expect(fail?.status).toBe(500);
    expect(fail?.model).toBe("deepseek-v4-flash");
    expect(typeof fail?.durationMs).toBe("number");
  });
});


/** 把若干字符串块做成一个字节 ReadableStream，模拟 SSE 响应体。 */
function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function deltaEvent(delta: unknown): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

describe("chatCompletionsStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("逐事件累积 content，onText 收到的是每次的全文；请求带 stream: true", async () => {
    let seenBody: { stream?: boolean; thinking?: unknown } = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seenBody = JSON.parse(String(init.body)) as typeof seenBody;
      return {
        ok: true,
        status: 200,
        body: sseBody([
          deltaEvent({ content: "早" }),
          // 事件被切成两块到账
          'data: {"choices":[{"delta":{"content":"。昨',
          '天还剩 2 件。"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      };
    });
    const texts: string[] = [];
    const res = await chatCompletionsStream({
      apiKey: "sk-test",
      request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: true },
      onText: (t) => texts.push(t),
    });
    expect(seenBody.stream).toBe(true);
    expect(seenBody.thinking).toEqual({ type: "disabled" });
    expect(texts).toEqual(["早", "早。昨天还剩 2 件。"]);
    expect(res).toEqual({ content: "早。昨天还剩 2 件。", tool_calls: [] });
  });

  it("tool_calls 按 index 分片重组：id/name/arguments 拼全，多个调用按 index 排序", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      body: sseBody([
        // 故意先发 index 1，验证最终按 index 排序而不是按到达顺序
        deltaEvent({ tool_calls: [{ index: 1, id: "call_b", function: { name: "set_today_plan", arguments: '{"items"' } }] }),
        deltaEvent({ tool_calls: [{ index: 0, id: "call_a", function: { name: "list_" } }] }),
        deltaEvent({ tool_calls: [{ index: 0, function: { name: "todos", arguments: "{}" } }] }),
        deltaEvent({ tool_calls: [{ index: 1, function: { arguments: ':[]}' } }] }),
        "data: [DONE]\n\n",
      ]),
    }));
    const texts: string[] = [];
    const res = await chatCompletionsStream({
      apiKey: "sk-test",
      request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: true },
      onText: (t) => texts.push(t),
    });
    expect(texts).toEqual([]);
    expect(res.content).toBeNull();
    expect(res.tool_calls).toEqual([
      { id: "call_a", type: "function", function: { name: "list_todos", arguments: "{}" } },
      { id: "call_b", type: "function", function: { name: "set_today_plan", arguments: '{"items":[]}' } },
    ]);
  });

  it("多字节字符被字节流从中间切断也不乱码", async () => {
    const full = deltaEvent({ content: "你好" }) + "data: [DONE]\n\n";
    const bytes = new TextEncoder().encode(full);
    // 「你」是 3 字节，从它的第 1 字节后切开
    const cut = bytes.indexOf(0xe4) + 1;
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, cut));
          controller.enqueue(bytes.slice(cut));
          controller.close();
        },
      }),
    }));
    const texts: string[] = [];
    const res = await chatCompletionsStream({
      apiKey: "sk-test",
      request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: true },
      onText: (t) => texts.push(t),
    });
    expect(res.content).toBe("你好");
    expect(texts.at(-1)).toBe("你好");
  });

  it("[DONE] 之后的事件不再处理", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      body: sseBody(["data: [DONE]\n\n", deltaEvent({ content: "不该出现" })]),
    }));
    const texts: string[] = [];
    const res = await chatCompletionsStream({
      apiKey: "sk-test",
      request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: true },
      onText: (t) => texts.push(t),
    });
    expect(texts).toEqual([]);
    expect(res.content).toBeNull();
  });

  it("非 2xx 复用 ApiError 与用户文案", async () => {
    debugLog.clear();
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "invalid" } }),
    }));
    await expect(
      chatCompletionsStream({
        apiKey: "sk-bad",
        request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: true },
        onText: () => {},
      }),
    ).rejects.toMatchObject({ status: 401, userMessage: "Key 不对或没有额度" });
    const fail = debugLog.entries.find((e) => e.event === "http_fail");
    expect(fail?.status).toBe(401);
    expect(debugLog.toText()).not.toContain("sk-bad");
  });

  it("fetch 直接 reject（没网）抛 status 0 的 ApiError", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      chatCompletionsStream({
        apiKey: "sk-test",
        request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: true },
        onText: () => {},
      }),
    ).rejects.toMatchObject({ status: 0, userMessage: "现在没网，过一会儿再聊。待办还可以勾" });
  });

  it("流读到一半断了也按 status 0 报错", async () => {
    let served = false;
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!served) {
            served = true;
            controller.enqueue(new TextEncoder().encode(deltaEvent({ content: "半截" })));
          } else {
            controller.error(new Error("connection reset"));
          }
        },
      }),
    }));
    const texts: string[] = [];
    await expect(
      chatCompletionsStream({
        apiKey: "sk-test",
        request: { model: "deepseek-v4-flash", messages: [], tools: [], stream: true },
        onText: (t) => texts.push(t),
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(texts).toEqual(["半截"]);
  });
});
