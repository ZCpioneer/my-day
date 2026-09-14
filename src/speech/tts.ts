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

/** 播放一段 wav。ended → true；play 被拒 / 解码失败 / 取消 → false。不抛。 */
export function playAudio(url: string, signal?: AbortSignal): Promise<boolean> {
  const src = httpsUrl(url);
  if (!src || signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    const a = getPlayer();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      a.onended = null;
      a.onerror = null;
      resolve(ok);
    };
    const onAbort = () => {
      try {
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch {
        /* ignore */
      }
      done(false);
    };

    a.onended = () => done(true);
    a.onerror = () => done(false);
    signal?.addEventListener("abort", onAbort, { once: true });
    a.muted = false;
    a.src = src;
    void a.play().catch(() => done(false));
  });
}
