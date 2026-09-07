export const DEFAULT_SPLIT_HOUR = 12;

export function clampSplitHour(hour: number): number {
  if (!Number.isFinite(hour)) return DEFAULT_SPLIT_HOUR;
  const n = Math.trunc(hour);
  if (n < 0) return 0;
  if (n > 23) return 23;
  return n;
}

/** splitHour 之前算「早」（开始），splitHour 起算「晚」（回顾）。 */
export function ritualForHour(hour: number, splitHour: number = DEFAULT_SPLIT_HOUR): "morning" | "evening" {
  return hour < clampSplitHour(splitHour) ? "morning" : "evening";
}

export function ritualForNow(now: Date = new Date(), splitHour: number = DEFAULT_SPLIT_HOUR): "morning" | "evening" {
  return ritualForHour(now.getHours(), splitHour);
}
