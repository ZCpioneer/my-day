# 语音模式云端朗读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 语音模式下，秘书整句写完后用百炼 `qwen3-tts-flash` 合成中文语音，用网页 `Audio` 播放，实现互相说话。

**Architecture:** HTTP 合成（`dashscope-tts.ts`）与播放（`tts.ts`）分开；`App.vue` 用同一个 `effectiveAsrKey` 装配 `speakReply`；`ChatScreen` 只在回复落库后调用注入函数，失败吞掉继续听。不再使用 `speechSynthesis`。

**Tech Stack:** Vue 3 + TypeScript + Vite，Capacitor 7 Android WebView，百炼 `qwen3-tts-flash`（`Cherry` / `Chinese`），vitest + happy-dom。

**Spec:** `docs/superpowers/specs/2026-09-14-voice-mode-cloud-tts-design.md`

## Global Constraints

- 中文用户文案与注释；不把 API Key 全文写入日志或文档
- 音色固定 `Cherry`，`language_type` 固定 `Chinese`；不新加设置项；`asrAppKey` 字段名不改
- 不混用 `speechSynthesis` 作回退；文字模式不朗读
- `PostJson` 类型不改（无 `AbortSignal`）；测试注入 `postJson`，默认路径才用 `fetch`+signal
- 不要 `git add src/debug/default-key.ts`
- 不改听/识别/流式出字/确认框/日记/待办行为
- 每个任务提交信息用中文

## File map

| 文件 | 职责 |
| --- | --- |
| Create `src/api/dashscope-tts.ts` | 一次 POST 合成，返回 wav URL |
| Create `src/__tests__/dashscope-tts.test.ts` | 合成客户端单测 |
| Modify `src/speech/tts.ts` | strip / 截断 / HTMLAudio 播放 / 预热；删除 speechSynthesis |
| Modify `src/__tests__/tts.test.ts` | 播放与截断单测 |
| Modify `src/screens/ChatScreen.vue` | `speakReply` 注入、预热、打断 abort、无 Key 文案 |
| Modify `src/__tests__/chat-screen.test.ts` | 朗读走 prop；失败不红字 |
| Modify `src/App.vue` | 装配 `onSpeakReply` |
| Modify `src/screens/SettingsScreen.vue` | 「语音 API Key」 |
| Modify `src/__tests__/settings-screen.test.ts` | 文案断言 |
| Modify `src/types.ts` | `asrAppKey` 注释 |
| Modify `src/api/dashscope-asr.ts` | 空 Key 文案与 TTS 对齐 |
| Modify `src/debug/default-key.example.ts` | 注释改为识别与朗读共用 |
| Modify `AGENTS.md`、`README.md` | 现状描述 |

---

### Task 1: 百炼 TTS HTTP 客户端

**Files:**
- Create: `src/api/dashscope-tts.ts`
- Create: `src/__tests__/dashscope-tts.test.ts`
- Modify: `src/api/dashscope-asr.ts`（空 Key 文案，与 TTS 同一句）

**Interfaces:**
- Consumes: `PostJson` from `src/api/deepseek.ts`；`nativePostJson` from `src/api/post-json.ts`；`Capacitor.isNativePlatform()`
- Produces:

```ts
export const TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
export const TTS_MODEL = "qwen3-tts-flash";
export const TTS_VOICE = "Cherry";
export function ttsHeaders(apiKey: string): Record<string, string>;
export function ttsBody(text: string): {
  model: string;
  input: { text: string; voice: string; language_type: "Chinese" };
};
export async function synthesizeSpeech(input: {
  apiKey: string;
  text: string;
  signal?: AbortSignal;
  postJson?: PostJson;
}): Promise<string>; // 返回 output.audio.url
```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/dashscope-tts.test.ts`:

```ts
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
```

Also change `src/__tests__/dashscope-asr.test.ts` empty-key case if the message text changes; it currently `toThrow("设置页")` which still matches.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/dashscope-tts.test.ts`

Expected: FAIL — cannot find module `@/api/dashscope-tts`

- [ ] **Step 3: Write minimal implementation**

Create `src/api/dashscope-tts.ts`:

```ts
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
```

In `src/api/dashscope-asr.ts`, change the empty-key throw from `"还没配置语音识别凭证，去设置页填一下"` to `"还没配置语音凭证，去设置页填一下"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/dashscope-tts.test.ts src/__tests__/dashscope-asr.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/dashscope-tts.ts src/__tests__/dashscope-tts.test.ts src/api/dashscope-asr.ts
git commit -m "feat: 百炼 qwen3-tts-flash 合成客户端"
```

---

### Task 2: HTMLAudio 播放（替换 speechSynthesis）

**Files:**
- Modify: `src/speech/tts.ts`（整文件替换）
- Modify: `src/__tests__/tts.test.ts`（整文件替换）

**Interfaces:**
- Consumes: 浏览器 `HTMLAudioElement`
- Produces:

```ts
export const TTS_MAX_CHARS = 500;
export function stripForSpeech(text: string): string;
export function textForSpeech(text: string): string; // strip 后截到 500
export function cancelSpeech(): void;
export function resetPlayback(): void; // 丢掉单例，仅测试用
export function warmupAudio(): Promise<void>;
export function playAudio(url: string, signal?: AbortSignal): Promise<void>;
```

不再导出 `speak()`。

- [ ] **Step 1: Write the failing test**

Replace `src/__tests__/tts.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelSpeech,
  playAudio,
  resetPlayback,
  stripForSpeech,
  textForSpeech,
  TTS_MAX_CHARS,
  warmupAudio,
} from "@/speech/tts";

describe("stripForSpeech", () => {
  it("去掉 **加粗**，换行变成句号", () => {
    expect(stripForSpeech("先做 **研究 AI 视频**，放以后。")).toBe("先做 研究 AI 视频，放以后。");
    expect(stripForSpeech("第一句\n\n第二句")).toBe("第一句。第二句");
  });

  it("空串保持空", () => {
    expect(stripForSpeech("   ")).toBe("");
  });
});

describe("textForSpeech", () => {
  it("截到 500 字", () => {
    expect(TTS_MAX_CHARS).toBe(500);
    expect(textForSpeech("**重点** 先做这件")).toBe("重点 先做这件");
    expect(textForSpeech("甲".repeat(520)).length).toBe(500);
  });
});

class FakeAudio {
  src = "";
  muted = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {
    queueMicrotask(() => this.onended?.());
  });
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
}

describe("playAudio", () => {
  let created: FakeAudio[];

  beforeEach(() => {
    created = [];
    resetPlayback();
    vi.stubGlobal(
      "Audio",
      class {
        constructor() {
          const a = new FakeAudio();
          created.push(a);
          return a;
        }
      },
    );
  });

  afterEach(() => {
    resetPlayback();
    vi.unstubAllGlobals();
  });

  it("http 改成 https，播完结束", async () => {
    await playAudio("http://cdn.example/a.wav");
    expect(created[0]?.src).toBe("https://cdn.example/a.wav");
    expect(created[0]?.play).toHaveBeenCalled();
  });

  it("play 失败也 resolve", async () => {
    vi.stubGlobal(
      "Audio",
      class {
        constructor() {
          const a = new FakeAudio();
          a.play = vi.fn(async () => {
            throw new Error("blocked");
          });
          created.push(a);
          return a;
        }
      },
    );
    await expect(playAudio("https://cdn.example/a.wav")).resolves.toBeUndefined();
  });

  it("abort 停播", async () => {
    const ac = new AbortController();
    vi.stubGlobal(
      "Audio",
      class {
        constructor() {
          const a = new FakeAudio();
          a.play = vi.fn(async () => {});
          created.push(a);
          return a;
        }
      },
    );
    const p = playAudio("https://cdn.example/a.wav", ac.signal);
    ac.abort();
    await p;
    expect(created[0]?.pause).toHaveBeenCalled();
  });

  it("cancelSpeech 调 pause", () => {
    const a = new FakeAudio();
    vi.stubGlobal(
      "Audio",
      class {
        constructor() {
          created.push(a);
          return a;
        }
      },
    );
    void playAudio("https://cdn.example/a.wav");
    cancelSpeech();
    expect(a.pause).toHaveBeenCalled();
  });

  it("warmupAudio 先 mute 再 unmute，后续播放复用同一个元素", async () => {
    await warmupAudio();
    expect(created).toHaveLength(1);
    expect(created[0]?.muted).toBe(false);
    await playAudio("https://cdn.example/a.wav");
    expect(created).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/tts.test.ts`

Expected: FAIL — `textForSpeech` / `playAudio` / `warmupAudio` / `resetPlayback` 未导出（或仍走 speechSynthesis）

- [ ] **Step 3: Write minimal implementation**

Replace `src/speech/tts.ts` with:

```ts
// 云端合成后的 wav 用 HTMLAudioElement 播放。Android WebView 里 speechSynthesis 经常空响。

export const TTS_MAX_CHARS = 500;

/** 去掉 **加粗** 等标记，换成适合朗读的纯文本。 */
export function stripForSpeech(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[*#`]/g, "")
    .replace(/\n+/g, "。")
    .replace(/。{2,}/g, "。")
    .trim();
}

export function textForSpeech(text: string): string {
  return stripForSpeech(text).slice(0, TTS_MAX_CHARS);
}

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

let player: HTMLAudioElement | null = null;

function getPlayer(): HTMLAudioElement {
  if (!player) player = new Audio();
  return player;
}

function httpsUrl(url: string): string {
  return url.startsWith("http://") ? `https://${url.slice("http://".length)}` : url;
}

export function resetPlayback(): void {
  try {
    player?.pause();
  } catch {
    /* ignore */
  }
  player = null;
}

export function cancelSpeech(): void {
  if (!player) return;
  try {
    player.pause();
    player.removeAttribute("src");
    player.load();
  } catch {
    /* ignore */
  }
}

/** 进语音模式时用用户手势预热，避免数秒后正式播放被拦住。失败忽略。 */
export async function warmupAudio(): Promise<void> {
  try {
    const a = getPlayer();
    a.muted = true;
    a.src = SILENT_WAV;
    await a.play();
    a.pause();
    a.muted = false;
    a.removeAttribute("src");
    a.load();
  } catch {
    try {
      if (player) player.muted = false;
    } catch {
      /* ignore */
    }
  }
}

/** 播放一段 wav。失败、取消、播完都 resolve，不抛。 */
export function playAudio(url: string, signal?: AbortSignal): Promise<void> {
  const src = httpsUrl(url);
  if (!src || signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const a = getPlayer();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      a.onended = null;
      a.onerror = null;
      resolve();
    };
    const onAbort = () => {
      try {
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch {
        /* ignore */
      }
      done();
    };

    a.onended = done;
    a.onerror = () => done();
    signal?.addEventListener("abort", onAbort, { once: true });
    a.muted = false;
    a.src = src;
    void a.play().catch(() => done());
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/tts.test.ts`

Expected: PASS

If `warmupAudio` 的 `muted` 断言失败：`play()` 的 Fake 实现会立刻 `onended`，但 warmup 不依赖 onended，只 await `play()`。确认 Fake `play` resolve 即可。`muted` 在成功路径末尾应为 `false`。

- [ ] **Step 5: Commit**

```bash
git add src/speech/tts.ts src/__tests__/tts.test.ts
git commit -m "feat: 朗读改用 HTMLAudio 播放 wav"
```

---

### Task 3: ChatScreen 走注入的 speakReply

**Files:**
- Modify: `src/screens/ChatScreen.vue`
- Modify: `src/__tests__/chat-screen.test.ts`

**Interfaces:**
- Consumes: `warmupAudio` / `cancelSpeech` from `@/speech/tts`
- Produces: prop `speakReply?: ((text: string, signal: AbortSignal) => Promise<void>) | null`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/chat-screen.test.ts`:

1. 删掉 `import { speak } from "@/speech/tts"`。
2. 把 `vi.mock("@/speech/tts")` 改成：

```ts
vi.mock("@/speech/tts", () => ({
  warmupAudio: vi.fn(async () => {}),
  cancelSpeech: vi.fn(),
}));
```

3. `beforeEach` 里删掉对 `speak` 的 `mockReset`。
4. 把「语音回复完成后朗读秘书的话」改成用 prop：

```ts
  it("语音回复完成后朗读秘书的话", async () => {
    const speakReply = vi.fn(async () => {});
    let calls = 0;
    mockMic(() => {
      calls += 1;
      if (calls === 1) return { finish() {}, cancel() {}, result: Promise.resolve("V0FW") };
      return hangListen();
    });
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: false,
        pendingPropose: null,
        recognize: async () => "研究 AI 视频",
        speakReply,
      },
    });
    await w.get("[data-testid=mode-voice]").trigger("click");
    await flushPromises();
    expect(w.emitted("send")).toBeTruthy();
    await w.setProps({ awaiting: true });
    await flushPromises();
    await w.setProps({
      awaiting: false,
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "**研究 AI 视频**，先放以后。",
          createdAt: "2026-09-05T01:00:00.000Z",
          mode: "chat",
        },
      ],
    });
    await flushPromises();
    expect(speakReply).toHaveBeenCalled();
    expect(speakReply.mock.calls[0][0]).toContain("研究 AI 视频");
    w.unmount();
  });

  it("朗读失败不挡下一轮听，也不出识别那种红字", async () => {
    const speakReply = vi.fn(async () => {
      throw new Error("合成失败");
    });
    let calls = 0;
    mockMic(() => {
      calls += 1;
      if (calls === 1) return { finish() {}, cancel() {}, result: Promise.resolve("V0FW") };
      return hangListen();
    });
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: false,
        pendingPropose: null,
        recognize: async () => "买牛奶",
        speakReply,
      },
    });
    await w.get("[data-testid=mode-voice]").trigger("click");
    await flushPromises();
    await w.setProps({ awaiting: true });
    await flushPromises();
    await w.setProps({
      awaiting: false,
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "记下了。",
          createdAt: "2026-09-05T01:00:00.000Z",
          mode: "chat",
        },
      ],
    });
    await flushPromises();
    expect(speakReply).toHaveBeenCalled();
    expect(w.find("[data-voice-error]").exists()).toBe(false);
    expect(calls).toBeGreaterThan(1);
    w.unmount();
  });
```

5. 把 ChatScreen 里 `还没配置语音识别凭证` 若有测试覆盖则改为「语音凭证」；当前测试没有覆盖这句，实现时改文案即可。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/chat-screen.test.ts`

Expected: FAIL — `speakReply` is not a declared prop，或朗读仍调 `speak` 所以 `speakReply` 未被调用

- [ ] **Step 3: Write minimal implementation**

In `src/screens/ChatScreen.vue`:

1. Import 改为：

```ts
import { cancelSpeech, warmupAudio } from "@/speech/tts";
```

（删除 `speak`）

2. Props 增加：

```ts
  /** 语音回复朗读：App 注入（拿着设置里的百炼凭证合成并播放）。 */
  speakReply?: ((text: string, signal: AbortSignal) => Promise<void>) | null;
```

3. `runVoiceSession` 开头，在 `const recognize = props.recognize` 之后立刻：

```ts
  void warmupAudio();
```

4. 无 recognize 的文案改为 `"还没配置语音凭证，去设置页填一下"`。

5. `speakLatest` 改为（失败吞掉，避免红字）：

```ts
async function speakLatest(signal: AbortSignal) {
  const id = lastAssistantId();
  const content = lastAssistantText();
  if (!id || id === spokenId || !content.trim()) return;
  const speakReply = props.speakReply;
  if (!speakReply) {
    spokenId = id;
    return;
  }
  spokenId = id;
  phase.value = "speaking";
  speakAbort?.abort();
  const ac = new AbortController();
  speakAbort = ac;
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await speakReply(content, ac.signal);
  } catch {
    /* 朗读失败不挡听 */
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (speakAbort === ac) speakAbort = null;
  }
}
```

`stopVoice` / 点打断仍调用 `speakAbort?.abort()` 和 `cancelSpeech()`（现有逻辑保留）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/chat-screen.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/ChatScreen.vue src/__tests__/chat-screen.test.ts
git commit -m "feat: 语音模式朗读改为注入 speakReply"
```

---

### Task 4: App 装配 + 设置文案 + 文档

**Files:**
- Modify: `src/App.vue`
- Modify: `src/screens/SettingsScreen.vue`
- Modify: `src/__tests__/settings-screen.test.ts`
- Modify: `src/types.ts`（`asrAppKey` 注释）
- Modify: `src/debug/default-key.example.ts`（注释）
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `synthesizeSpeech` from `@/api/dashscope-tts`；`playAudio` / `textForSpeech` from `@/speech/tts`；`effectiveAsrKey`
- Produces: `onSpeakReply(text: string, signal?: AbortSignal): Promise<void>` 传给 ChatScreen

- [ ] **Step 1: Write the failing test**

In `src/__tests__/settings-screen.test.ts`:

- `describe` 名称可改为 `SettingsScreen 语音`
- `expect(text).toContain("语音识别 API Key")` 改为 `expect(text).toContain("语音 API Key")`
- `expect(text).not.toContain("语音识别 API Key")` 可选，避免改完后旧文案残留；加上更稳：

```ts
    expect(text).toContain("语音 API Key");
    expect(text).not.toContain("语音识别 API Key");
    expect(text).toContain("阿里云百炼");
```

保留「只有两个 password、没有 APP Key / Action Token / 豆包」。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/settings-screen.test.ts`

Expected: FAIL — 仍显示「语音识别 API Key」

- [ ] **Step 3: Write minimal implementation**

`SettingsScreen.vue` 标签与 hint：

```html
        <span>语音 API Key</span>
        <input v-model="draft.asrAppKey" type="password" autocomplete="off" placeholder="留空则用内置调试 Key" />
        <p class="hint">识别和朗读共用（阿里云百炼）。可以自己贴 Key。不填就用内置的调试 Key。</p>
```

`src/types.ts`：

```ts
  /** 阿里云百炼 API Key（识别 qwen3-asr-flash + 朗读 qwen3-tts-flash）。空则用内置调试 Key。 */
  asrAppKey?: string;
```

`src/debug/default-key.example.ts`：

```ts
/** DEBUG ONLY，正式发布前删除。阿里云百炼语音 Key（识别与朗读共用）。 */
export const DEFAULT_DEBUG_ASR_KEY = "";
```

不要修改或 `git add` `src/debug/default-key.ts`。若本地该文件注释仍写「识别」，可顺手改注释但不入库。

`src/App.vue`：

1. 增加 import：

```ts
import { synthesizeSpeech } from "@/api/dashscope-tts";
import { playAudio, textForSpeech } from "@/speech/tts";
```

2. 模板 ChatScreen 增加 `:speak-reply="onSpeakReply"`（紧挨 `:recognize="onRecognize"`）。

3. 在 `onRecognize` 旁增加：

```ts
async function onSpeakReply(text: string, signal?: AbortSignal): Promise<void> {
  const said = textForSpeech(text);
  if (!said || signal?.aborted) return;
  try {
    const url = await synthesizeSpeech({
      apiKey: effectiveAsrKey(settings.value) ?? "",
      text: said,
      signal,
    });
    if (signal?.aborted) return;
    await playAudio(url, signal);
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
    debugLog.push({ event: "http_fail", detail: `tts: ${e instanceof Error ? e.message : "unknown"}` });
  }
}
```

`AGENTS.md` 项目概览「网络」句：把「只给百炼 ASR」改成「只给百炼 ASR / TTS」。

`AGENTS.md` 语音条替换为：

> 语音：对话页顶部分段「文字对话 / 语音模式」。文字模式纯打字；语音模式开口即录、停顿约 1 秒提交（VAD 在 `src/speech/vad.ts`），阿里云百炼 `qwen3-asr-flash` 转写（`src/api/dashscope-asr.ts`，一次 POST，音频走 wav data URI；不走流式 WebSocket），同一条对话线程里出字；回复整句落库后用百炼 `qwen3-tts-flash` 合成（`src/api/dashscope-tts.ts`，音色 Cherry），`HTMLAudioElement` 播放（`src/speech/tts.ts`）。录音：WebView 内 MediaRecorder → 16k 单声道 WAV → base64（`src/speech/`）。凭证只留一个 `asrAppKey`（百炼 API Key，识别与朗读共用）存设置，空则回退 `DEFAULT_DEBUG_ASR_KEY`（`effectiveAsrKey`）。原生 Manifest 必须同时有 `RECORD_AUDIO` 和 `MODIFY_AUDIO_SETTINGS`（Capacitor 的 `onPermissionRequest` 会两个一起要，缺后者时系统已授权麦克风也会被当成整次拒绝）。WebView 权限弹窗由 Capacitor 7 `BridgeWebChromeClient` 处理，MainActivity 不用改

`AGENTS.md` 代码组织 `speech/` 一行：把「系统 TTS」改成「HTMLAudio 播放」。

`AGENTS.md` 若 `src/api/` 列表还没有 `dashscope-tts.ts`，补上：`dashscope-tts.ts   百炼语音合成（qwen3-tts-flash，一次 POST 回 wav URL）`。

`README.md`：

- 「语音识别发给阿里云百炼」→「语音识别和朗读发给阿里云百炼」
- 「语音：百炼 `qwen3-asr-flash` 转写 + 系统 TTS」→「语音：百炼 `qwen3-asr-flash` 转写 + `qwen3-tts-flash` 朗读」

- [ ] **Step 4: Run tests and production build**

Run:

```bash
npm run test
npm run build
```

Expected: 全部测试 PASS；`vue-tsc -b && vite build` 成功。

- [ ] **Step 5: Commit**

```bash
git add src/App.vue src/screens/SettingsScreen.vue src/__tests__/settings-screen.test.ts src/types.ts src/debug/default-key.example.ts AGENTS.md README.md
git commit -m "feat: 语音模式用百炼合成朗读秘书回复"
```

不要 `git add src/debug/default-key.ts`。

---

## Self-review vs spec

| Spec 条目 | 任务 |
| --- | --- |
| `qwen3-tts-flash` + Cherry + Chinese + multimodal URL | Task 1 |
| fetch + AbortSignal；测试注入 postJson；原生 CORS 退 nativePostJson | Task 1 |
| 空 Key / 非 200 / 无 url 抛中文错误 | Task 1 |
| strip + 截断 500 | Task 2 `textForSpeech`；Task 4 `onSpeakReply` 使用 |
| `playAudio` http→https、失败 resolve、abort 停播 | Task 2 |
| `warmupAudio` 进语音模式点击路径 | Task 2 实现 + Task 3 `runVoiceSession` 调用 |
| ChatScreen 注入 speakReply，不再 import 合成 | Task 3 |
| 朗读失败不红字、继续听 | Task 3 catch + 测试 |
| App 装配、debugLog `tts:`、abort 不记失败 | Task 4 |
| 设置页「语音 API Key」、字段名不改 | Task 4 |
| AGENTS.md / README 去掉系统 TTS | Task 4 |
| 不混用 speechSynthesis、不改待办/日记 | 各任务均不碰 |
| `npm run test` + `npm run build` | Task 4 Step 4 |
