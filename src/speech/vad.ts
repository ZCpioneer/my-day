// 简单能量 VAD：用 RMS 判断开口 / 停顿，给「说完停一下就提交」用。

export const VAD = {
  speechRms: 0.018,
  silenceMs: 1000,
  minSpeechMs: 400,
  pollMs: 50,
} as const;

export interface VadState {
  heard: boolean;
  speechMs: number;
  silenceMs: number;
}

export type VadDecision = "wait" | "speech" | "end";

export function emptyVad(): VadState {
  return { heard: false, speechMs: 0, silenceMs: 0 };
}

export function rms(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / n);
}

/** 把 0–255 的字节时域（128=静音）换成约 [-1,1] 再算 RMS。 */
export function rmsFromBytes(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const v = (samples[i] - 128) / 128;
    s += v * v;
  }
  return Math.sqrt(s / n);
}

export function tickVad(state: VadState, energy: number, dtMs: number, cfg = VAD): { state: VadState; decision: VadDecision } {
  const speaking = energy >= cfg.speechRms;
  if (!state.heard) {
    if (!speaking) return { state, decision: "wait" };
    return { state: { heard: true, speechMs: dtMs, silenceMs: 0 }, decision: "speech" };
  }
  if (speaking) {
    return { state: { heard: true, speechMs: state.speechMs + dtMs, silenceMs: 0 }, decision: "speech" };
  }
  const silenceMs = state.silenceMs + dtMs;
  if (silenceMs < cfg.silenceMs) {
    return { state: { ...state, silenceMs }, decision: "speech" };
  }
  if (state.speechMs >= cfg.minSpeechMs) {
    return { state: { ...state, silenceMs }, decision: "end" };
  }
  return { state: emptyVad(), decision: "wait" };
}
