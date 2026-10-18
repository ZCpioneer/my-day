// 一句一停：进语音模式开一次麦克风，开口才开录，停顿约 1 秒结束，产出 WAV base64。
import { blobToWavBase64, createRecorder, MAX_RECORD_MS, micError, openMic } from "./recorder";
import { emptyVad, rms, rmsFromBytes, tickVad, VAD } from "./vad";

export class ListenCancelled extends Error {
  constructor() {
    super("listen-cancelled");
    this.name = "ListenCancelled";
  }
}

export interface UtteranceListener {
  /** 当作已经停顿，结束本句（还没开口则得到空串）。 */
  finish(): void;
  /** 丢弃本句。 */
  cancel(): void;
  result: Promise<string>;
}

export interface MicSession {
  listen(opts?: { signal?: AbortSignal; onSpeechStart?: () => void }): UtteranceListener;
  close(): void;
}

function readEnergy(analyser: AnalyserNode, floatBuf: Float32Array<ArrayBuffer>, byteBuf: Uint8Array<ArrayBuffer>): number {
  if (typeof analyser.getFloatTimeDomainData === "function") {
    analyser.getFloatTimeDomainData(floatBuf);
    return rms(floatBuf);
  }
  analyser.getByteTimeDomainData(byteBuf);
  return rmsFromBytes(byteBuf);
}

/** 用户点进语音模式时调用（有手势，AudioContext 能 resume）。关掉会话才释放麦克风。 */
export async function openMicSession(): Promise<MicSession> {
  let stream: MediaStream;
  try {
    stream = await openMic();
  } catch (e) {
    throw e instanceof Error ? e : micError(e);
  }
  const ctx = new AudioContext();
  try {
    await ctx.resume();
  } catch {
    /* 有的环境 resume 会拒，继续用 */
  }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
  }

  function listen(opts?: { signal?: AbortSignal; onSpeechStart?: () => void }): UtteranceListener {
    let finished = false;
    let cancelled = false;
    let rec: MediaRecorder | null = null;
    let stopPoll: (() => void) | null = null;
    let resolveWait: (() => void) | null = null;
    let fail: Error | null = null;

    function finish() {
      if (finished || cancelled) return;
      finished = true;
      resolveWait?.();
    }

    function cancel() {
      if (cancelled) return;
      cancelled = true;
      finished = true;
      resolveWait?.();
    }

    const result = (async () => {
      if (closed) throw new ListenCancelled();
      const floatBuf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      const byteBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      rec = createRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      let vad = emptyVad();
      let last = performance.now();
      let recStarted = false;
      let maxTimer: number | undefined;

      const poll = window.setInterval(() => {
        if (cancelled || finished || closed) return;
        const energy = readEnergy(analyser, floatBuf, byteBuf);
        const now = performance.now();
        const dt = now - last;
        last = now;
        const stepped = tickVad(vad, energy, dt);
        vad = stepped.state;
        if (stepped.decision === "speech" && !recStarted) {
          recStarted = true;
          try {
            rec!.start(200);
          } catch (e) {
            fail = e instanceof Error ? e : new Error("录音失败");
            cancel();
            return;
          }
          maxTimer = window.setTimeout(() => finish(), MAX_RECORD_MS);
          opts?.onSpeechStart?.();
        }
        if (stepped.decision === "end") finish();
      }, VAD.pollMs);

      stopPoll = () => {
        clearInterval(poll);
        if (maxTimer !== undefined) window.clearTimeout(maxTimer);
      };

      const onAbort = () => cancel();
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts?.signal?.aborted || closed) cancel();

      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        if (finished || cancelled) resolve();
      });
      opts?.signal?.removeEventListener("abort", onAbort);
      stopPoll();

      if (fail) throw fail;
      if (cancelled || closed) throw new ListenCancelled();
      if (!recStarted || !rec || rec.state === "inactive") return "";

      const recorder = rec;
      rec = null;
      const blob = await new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        recorder.onerror = () => reject(new Error("录音失败"));
        try {
          if (recorder.state !== "inactive") recorder.stop();
          else resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        } catch (e) {
          reject(e instanceof Error ? e : new Error("录音失败"));
        }
      });
      if (blob.size === 0) return "";
      return blobToWavBase64(blob);
    })();

    return { finish, cancel, result };
  }

  return { listen, close };
}
