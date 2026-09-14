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
