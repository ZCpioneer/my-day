import { describe, it, expect } from "vitest";
import { chatCompletions, userMessageForStatus, ApiError } from "@/api/deepseek";
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
