import { Capacitor, CapacitorHttp } from "@capacitor/core";
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
  return Capacitor.isNativePlatform() ? nativePostJson : browserPostJson;
}
