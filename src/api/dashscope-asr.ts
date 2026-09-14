// 阿里云百炼 qwen3-asr-flash：一次 HTTPS POST（body 里带 wav 的 data URI）即回全文。
// 走 OpenAI 兼容 chat/completions，WebView 里 fetch 能带 Authorization。
// 文档：https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference
import type { PostJson } from "./deepseek";
import { activePostJson, nativePostJson } from "./post-json";
import { Capacitor } from "@capacitor/core";

export const ASR_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
export const ASR_MODEL = "qwen3-asr-flash";

export function asrHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

export function asrBody(wavBase64: string) {
  return {
    model: ASR_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: `data:audio/wav;base64,${wavBase64}` },
          },
        ],
      },
    ],
    stream: false,
  };
}

/** 识别一段 WAV（base64），返回识别文本；失败抛中文错误。 */
export async function recognizeSpeech(input: {
  apiKey: string;
  wavBase64: string;
  postJson?: PostJson;
}): Promise<string> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("还没配置语音凭证，去设置页填一下");
  const headers = asrHeaders(apiKey);
  const body = asrBody(input.wavBase64);
  let res = await (input.postJson ?? activePostJson())(ASR_URL, headers, body);
  // 浏览器/WebView fetch 被 CORS 挡住时 status=0：原生端退到 CapacitorHttp（原生层发请求没有 CORS）。
  if (res.status === 0 && !input.postJson && Capacitor.isNativePlatform()) {
    res = await nativePostJson(ASR_URL, headers, body);
  }
  const json = res.json as {
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string };
    message?: string;
  };
  if (res.status === 0) throw new Error("网络不通，识别请求没发出去");
  if (res.status !== 200) {
    throw new Error(json?.error?.message || json?.message || `识别服务返回异常（HTTP ${res.status}）`);
  }
  const text = json?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("没听清，换个安静点的地方再说一次");
  return text;
}
