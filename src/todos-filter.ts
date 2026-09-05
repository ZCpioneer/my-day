import type { ProposedTodo, Todo } from "./types";

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function filterProposedTodos(proposed: ProposedTodo[], existing: Todo[]): ProposedTodo[] {
  const seen = new Set(existing.map((t) => norm(t.title)));
  const out: ProposedTodo[] = [];
  for (const p of proposed) {
    const title = p.title.trim();
    if (!title) continue;
    const key = norm(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, reason: p.reason?.trim() || undefined });
  }
  return out;
}
