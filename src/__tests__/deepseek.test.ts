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
    expect(debugLog.entries.some((e) => e.event === "http_fail")).toBe(true);
  });
});
