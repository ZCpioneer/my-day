export function normKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}
