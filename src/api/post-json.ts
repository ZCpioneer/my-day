import { CapacitorHttp } from "@capacitor/core";
import type { PostJson } from "./deepseek";

export const browserPostJson: PostJson = async (url, headers, body) => {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch {
    return { status: 0, json: {} };
  }
};

// 兜底实现，保留导出但不再默认使用：DeepSeek 已支持 CORS，原生端同样走 fetch；
// 且 CapacitorHttp 的 fetch patch 会把响应缓冲完才返回，会破坏流式（见 capacitor.config.ts）。
export const nativePostJson: PostJson = async (url, headers, body) => {
  try {
    const res = await CapacitorHttp.request({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      data: body,
      connectTimeout: 30000,
      readTimeout: 60000,
    });
    return { status: res.status, json: res.data };
  } catch {
    return { status: 0, json: {} };
  }
};

export function activePostJson(): PostJson {
  // 全平台统一走 fetch：DeepSeek 已全量放开 CORS，不再需要原生端绕路。
  return browserPostJson;
}
