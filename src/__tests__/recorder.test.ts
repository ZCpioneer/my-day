import { describe, expect, it, vi } from "vitest";
import { micError, pickRecorderMime } from "@/speech/recorder";

describe("micError", () => {
  it("按 DOMException.name 翻译成中文", () => {
    expect(micError(new DOMException("denied", "NotAllowedError")).message).toContain("麦克风权限被拒绝");
    expect(micError(new DOMException("none", "NotFoundError")).message).toContain("找不到麦克风");
    expect(micError(new DOMException("busy", "NotReadableError")).message).toContain("被占用");
    expect(micError(new DOMException("sec", "SecurityError")).message).toContain("不允许");
    expect(micError(new DOMException("over", "OverconstrainedError")).message).toContain("麦克风参数不支持");
    expect(micError(new DOMException("aborted", "AbortError")).message).toContain("录音被中断");
  });

  it("未知错误保留原消息，不是一律说权限被拒绝", () => {
    expect(micError(new Error("MediaRecorder 不支持")).message).toBe("MediaRecorder 不支持");
    expect(micError("weird")).toEqual(new Error("打不开麦克风"));
  });
});

describe("pickRecorderMime", () => {
  it("挑第一个浏览器声称支持的类型", () => {
    const orig = globalThis.MediaRecorder;
    vi.stubGlobal(
      "MediaRecorder",
      class {
        static isTypeSupported(t: string) {
          return t === "audio/mp4";
        }
      },
    );
    expect(pickRecorderMime()).toBe("audio/mp4");
    vi.stubGlobal("MediaRecorder", orig);
  });

  it("没有 MediaRecorder 时返回 undefined", () => {
    const orig = globalThis.MediaRecorder;
    // @ts-expect-error 模拟不支持录音的环境
    globalThis.MediaRecorder = undefined;
    expect(pickRecorderMime()).toBeUndefined();
    vi.stubGlobal("MediaRecorder", orig);
  });
});
