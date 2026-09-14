export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftLocalDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return localDate(dt);
}

/** 「9月7日」式的短标签。 */
export function dayLabel(iso: string): string {
  const parts = iso.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** 「周一」式的星期；周日是「周日」。 */
export function weekdayLabel(iso: string): string {
  return WEEKDAYS[fromIso(iso).getDay()] ?? "";
}

/** 「5日」式的日序号。 */
export function dayNumLabel(iso: string): string {
  return `${Number(iso.split("-")[2])}日`;
}

/** 同年「9月」，跨年「2025年12月」。 */
export function monthLabel(iso: string, todayIso: string = localDate()): string {
  const [y, m] = iso.split("-").map(Number);
  const ty = Number(todayIso.slice(0, 4));
  return y === ty ? `${Number(m)}月` : `${y}年${Number(m)}月`;
}

/** ISO 周键（周一为一周开始，第一周是含 1 月 4 日的那周），全程按本地时间算，不碰 UTC。 */
export function weekKey(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // 本周周四落在哪年，这一周就属于哪个 ISO 年。
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 本周七天（周一到周日）的本地日历日。 */
export function weekDates(now: Date = new Date()): string[] {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(localDate(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}
