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
