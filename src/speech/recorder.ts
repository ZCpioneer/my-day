// 录音采集：MediaRecorder 录完 → 解码 → 重采样成 16k 单声道 WAV，交给 ASR 上传。
// 只在用户进入语音模式 / 开口时才碰麦克风。
import { bytesToBase64, encodeWav, floatToPcm16, mixToMono, resampleLinear } from "./wav";

export const MAX_RECORD_MS = 60_000;

const RECORDER_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];

/** 把 getUserMedia / 录音异常翻译成给用户看的中文。 */
export function micError(e: unknown): Error {
  const name =
    e instanceof DOMException || (e !== null && typeof e === "object" && "name" in e)
      ? String((e as { name: string }).name)
      : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new Error("麦克风权限被拒绝，请在系统设置里允许后重试");
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new Error("找不到麦克风");
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new Error("麦克风被占用，关掉其他录音应用后再试");
  }
  if (name === "SecurityError") {
    return new Error("当前页面不允许使用麦克风");
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return new Error("麦克风参数不支持");
  }
  if (name === "AbortError") {
    return new Error("录音被中断");
  }
  const msg = e instanceof Error && e.message.trim() ? e.message : "打不开麦克风";
  return new Error(msg);
}

export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return RECORDER_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export async function openMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前环境不支持录音");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    throw micError(e);
  }
}

export function createRecorder(stream: MediaStream): MediaRecorder {
  if (typeof MediaRecorder === "undefined") throw new Error("当前环境不支持录音");
  const mime = pickRecorderMime();
  try {
    return mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch {
    return new MediaRecorder(stream);
  }
}

/** 浏览器录出的容器（webm/opus）解码 → 16k 单声道 WAV → base64。 */
export async function blobToWavBase64(blob: Blob): Promise<string> {
  const raw = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(raw);
    const channels: Float32Array[] = [];
    for (let i = 0; i < audio.numberOfChannels; i++) channels.push(audio.getChannelData(i));
    const mono = mixToMono(channels);
    const pcm = floatToPcm16(resampleLinear(mono, audio.sampleRate, 16000));
    return bytesToBase64(new Uint8Array(encodeWav(pcm, 16000)));
  } finally {
    void ctx.close();
  }
}
