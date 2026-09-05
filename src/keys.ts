export function resolveApiKey(settingsKey: string, defaultKey: string): string | null {
  const a = settingsKey.trim();
  if (a) return a;
  const b = defaultKey.trim();
  if (b) return b;
  return null;
}

export function maskKey(key: string): string {
  const t = key.trim();
  if (t.length <= 4) return "****";
  return `${t.slice(0, 4)}****`;
}
