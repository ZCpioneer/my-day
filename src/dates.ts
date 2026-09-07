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
