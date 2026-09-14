import { describe, it, expect } from "vitest";
import { TTS_MODEL, TTS_URL, TTS_VOICE, ttsBody, ttsHeaders, synthesizeSpeech } from "@/api/dashscope-tts";
import type { PostJson } from "@/api/deepseek";

const okJson: PostJson = async () => ({
  status: 200,
  json: { output: { audio: { url: "https://dashscope-result.oss/x.wav" } } },
});

describe("dashscope-tts", () => {
  it("用百炼北京 multimodal 接口、Cherry、中文", () => {
    expect(TTS_URL).toBe("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
    expect(TTS_MODEL).toBe("qwen3-tts-flash");
    expect(TTS_VOICE).toBe("Cherry");
    expect(ttsHeaders("sk-user")["Authorization"]).toBe("Bearer sk-user");
    expect(ttsBody("你好").input).toEqual({
      text: "你好",
      voice: "Cherry",
      language_type: "Chinese",
    });
  });

  it("成功返回 wav url", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: unknown;
    const postJson: PostJson = async (url, headers, body) => {
      seenUrl = url;
      seenHeaders = headers;
      seenBody = body;
      return { status: 200, json: { output: { audio: { url: " https://cdn.example/a.wav " } } } };
    };
    const url = await synthesizeSpeech({ apiKey: "sk-user", text: "先做这件", postJson });
    expect(url).toBe("https://cdn.example/a.wav");
    expect(seenUrl).toBe(TTS_URL);
    expect(seenHeaders["Authorization"]).toBe("Bearer sk-user");
    expect((seenBody as ReturnType<typeof ttsBody>).model).toBe("qwen3-tts-flash");
    expect((seenBody as ReturnType<typeof ttsBody>).input.text).toBe("先做这件");
  });

  it("没填凭证直接报去设置页", async () => {
    await expect(synthesizeSpeech({ apiKey: "", text: "你好", postJson: okJson })).rejects.toThrow("语音凭证");
  });

  it("已经 abort 则不发请求", async () => {
    const ac = new AbortController();
    ac.abort();
    let called = 0;
    const postJson: PostJson = async () => {
      called += 1;
      return { status: 200, json: { output: { audio: { url: "https://x.wav" } } } };
    };
    await expect(
      synthesizeSpeech({ apiKey: "sk-user", text: "你好", signal: ac.signal, postJson }),
    ).rejects.toThrow();
    expect(called).toBe(0);
  });

  it("HTTP 错误带服务文案", async () => {
    const bad: PostJson = async () => ({ status: 403, json: { message: "无权访问" } });
    await expect(synthesizeSpeech({ apiKey: "sk-user", text: "你好", postJson: bad })).rejects.toThrow("无权访问");
  });

  it("网络不通（status 0）报网络错误", async () => {
    const dead: PostJson = async () => ({ status: 0, json: {} });
    await expect(synthesizeSpeech({ apiKey: "sk-user", text: "你好", postJson: dead })).rejects.toThrow("网络不通");
  });

  it("响应没有音频 url 报错", async () => {
    const empty: PostJson = async () => ({ status: 200, json: { output: { audio: { url: "" } } } });
    await expect(synthesizeSpeech({ apiKey: "sk-user", text: "你好", postJson: empty })).rejects.toThrow("没有合成到声音");
  });
});
