import { describe, expect, it } from "vitest";
import { emptyVad, rms, rmsFromBytes, tickVad, VAD } from "@/speech/vad";

describe("vad", () => {
  it("rms：空数组为 0，常数能量可算", () => {
    expect(rms([])).toBe(0);
    expect(rms([0, 0, 0])).toBe(0);
    expect(rms([1, 0, -1, 0])).toBeCloseTo(Math.sqrt(0.5));
  });

  it("rmsFromBytes：128 为静音", () => {
    expect(rmsFromBytes([128, 128, 128])).toBe(0);
    expect(rmsFromBytes([255, 1])).toBeGreaterThan(0.8);
  });

  it("未开口时低能量继续等，越过阈值进入 speech", () => {
    const quiet = tickVad(emptyVad(), 0.001, 50);
    expect(quiet.decision).toBe("wait");
    const open = tickVad(quiet.state, VAD.speechRms, 50);
    expect(open.decision).toBe("speech");
    expect(open.state.heard).toBe(true);
  });

  it("开口后短暂停顿不够长，仍算一句里", () => {
    let s = tickVad(emptyVad(), 0.05, 50).state;
    s = tickVad(s, 0.05, 400).state;
    const pause = tickVad(s, 0, 200);
    expect(pause.decision).toBe("speech");
  });

  it("开口够长再静音满阈值 → end", () => {
    let cur = emptyVad();
    cur = tickVad(cur, 0.05, VAD.minSpeechMs).state;
    const end = tickVad(cur, 0, VAD.silenceMs);
    expect(end.decision).toBe("end");
  });

  it("开口太短就静音，重置回 wait", () => {
    let cur = emptyVad();
    cur = tickVad(cur, 0.05, 80).state;
    const reset = tickVad(cur, 0, VAD.silenceMs);
    expect(reset.decision).toBe("wait");
    expect(reset.state.heard).toBe(false);
  });
});
