// 阿里云百炼 qwen3-tts-flash：一次 HTTPS POST 换 wav URL。非流式。
// 文档：https://help.aliyun.com/zh/model-studio/qwen-tts-api
import { Capacitor } from "@capacitor/core";
import type { PostJson } from "./deepseek";
import { nativePostJson } from "./post-json";

export const TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
export const TTS_MODEL = "qwen3-tts-flash";
export const TTS_VOICE = "Cherry";

export function ttsHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

export function ttsBody(text: string) {
  return {
    model: TTS_MODEL,
    input: {
      text,
      voice: TTS_VOICE,
      language_type: "Chinese" as const,
    },
  };
}

type TtsJson = {
  output?: { audio?: { url?: string | null } };
  error?: { message?: string };
  message?: string;
};

async function fetchTts(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof Error && e.name === "AbortError") throw e;
    return { status: 0, json: {} };
  }
}

/** 合成一段中文，返回马上可播的 wav URL；失败抛中文错误。 */
export async function synthesizeSpeech(input: {
  apiKey: string;
  text: string;
  signal?: AbortSignal;
  postJson?: PostJson;
}): Promise<string> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("还没配置语音凭证，去设置页填一下");
  if (input.signal?.aborted) throw new DOMException("aborted", "AbortError");

  const headers = ttsHeaders(apiKey);
  const body = ttsBody(input.text);
  let res: { status: number; json: unknown };

  if (input.postJson) {
    res = await input.postJson(TTS_URL, headers, body);
    if (input.signal?.aborted) throw new DOMException("aborted", "AbortError");
  } else {
    res = await fetchTts(TTS_URL, headers, body, input.signal);
    if (res.status === 0 && !input.signal?.aborted && Capacitor.isNativePlatform()) {
      res = await nativePostJson(TTS_URL, headers, body);
      if (input.signal?.aborted) throw new DOMException("aborted", "AbortError");
    }
  }

  const json = res.json as TtsJson;
  if (res.status === 0) throw new Error("网络不通，朗读请求没发出去");
  if (res.status !== 200) {
    throw new Error(json?.error?.message || json?.message || `朗读服务返回异常（HTTP ${res.status}）`);
  }
  const url = json?.output?.audio?.url?.trim() ?? "";
  if (!url) throw new Error("没有合成到声音");
  return url;
}
