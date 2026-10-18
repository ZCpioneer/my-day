export function normKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 去掉空白、忽略大小写后，一方完整包含另一方（含完全相同）。空串不算。 */
export function titlesOverlap(a: string, b: string): boolean {
  const x = normKey(a);
  const y = normKey(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}
