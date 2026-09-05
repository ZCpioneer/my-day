import type { ChatMessage, ChatMode } from "./types";

export const DEFAULT_SPLIT_HOUR = 12;

export function clampSplitHour(hour: number): number {
  if (!Number.isFinite(hour)) return DEFAULT_SPLIT_HOUR;
  const n = Math.trunc(hour);
  if (n < 0) return 0;
  if (n > 23) return 23;
  return n;
}

/** Hours before splitHour are 朝 (start); splitHour and after are 暮 (end). */
export function ritualForHour(hour: number, splitHour: number = DEFAULT_SPLIT_HOUR): "morning" | "evening" {
  return hour < clampSplitHour(splitHour) ? "morning" : "evening";
}

export function ritualForNow(now: Date = new Date(), splitHour: number = DEFAULT_SPLIT_HOUR): "morning" | "evening" {
  return ritualForHour(now.getHours(), splitHour);
}

export function sessionOf(message: ChatMessage): "morning" | "evening" {
  return message.mode === "evening" ? "evening" : "morning";
}

export function sessionMessages(messages: ChatMessage[], session: ChatMode): ChatMessage[] {
  const want = session === "evening" ? "evening" : "morning";
  return messages.filter((m) => sessionOf(m) === want);
}
