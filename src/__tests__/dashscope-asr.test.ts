import { describe, it, expect } from "vitest";
import { ASR_MODEL, ASR_URL, asrBody, asrHeaders, recognizeSpeech } from "@/api/dashscope-asr";
import type { PostJson } from "@/api/deepseek";

const okJson: PostJson = async () => ({
  status: 200,
  json: { choices: [{ message: { content: " 买牛奶 " } }] },
});

describe("dashscope-asr", () => {
  it("用百炼北京兼容接口和 Bearer Key", () => {
    expect(ASR_URL).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(ASR_MODEL).toBe("qwen3-asr-flash");
    expect(asrHeaders("sk-user")["Authorization"]).toBe("Bearer sk-user");
  });

  it("成功返回去空白后的识别文本，body 里带 wav 的 data URI", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: unknown;
    const postJson: PostJson = async (url, headers, body) => {
      seenUrl = url;
      seenHeaders = headers;
      seenBody = body;
      return { status: 200, json: { choices: [{ message: { content: " 买牛奶 " } }] } };
    };
    const text = await recognizeSpeech({ apiKey: "sk-user", wavBase64: "QUJD", postJson });
    expect(text).toBe("买牛奶");
    expect(seenUrl).toBe(ASR_URL);
    expect(seenHeaders["Authorization"]).toBe("Bearer sk-user");
    const body = asrBody("QUJD");
    expect((seenBody as typeof body).model).toBe("qwen3-asr-flash");
    expect(
      (seenBody as { messages: { content: { input_audio: { data: string } }[] }[] }).messages[0].content[0]
        .input_audio.data,
    ).toBe("data:audio/wav;base64,QUJD");
  });

  it("没填凭证直接报去设置页", async () => {
    await expect(recognizeSpeech({ apiKey: "", wavBase64: "QUJD", postJson: okJson })).rejects.toThrow("设置页");
  });

  it("空结果提示没听清", async () => {
    const empty: PostJson = async () => ({ status: 200, json: { choices: [{ message: { content: "  " } }] } });
    await expect(recognizeSpeech({ apiKey: "sk-user", wavBase64: "QUJD", postJson: empty })).rejects.toThrow("没听清");
  });

  it("HTTP 错误带服务文案", async () => {
    const bad: PostJson = async () => ({ status: 403, json: { error: { message: "无权访问" } } });
    await expect(recognizeSpeech({ apiKey: "sk-user", wavBase64: "QUJD", postJson: bad })).rejects.toThrow("无权访问");
  });

  it("网络不通（status 0）报网络错误", async () => {
    const dead: PostJson = async () => ({ status: 0, json: {} });
    await expect(recognizeSpeech({ apiKey: "sk-user", wavBase64: "QUJD", postJson: dead })).rejects.toThrow("网络不通");
  });
});
