import { normKey } from "./norm";
import type { ProposedTodo } from "./types";

export function filterTodayPlanItems(proposed: ProposedTodo[]): ProposedTodo[] {
  const seen = new Set<string>();
  const out: ProposedTodo[] = [];
  for (const p of proposed) {
    const title = p.title.trim();
    if (!title) continue;
    const key = normKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, reason: p.reason?.trim() || undefined, when: "today" });
  }
  return out;
}

export const MAX_TODAY_PLAN = 4;

function asPlanBucket(raw: unknown, when: "today" | "later"): ProposedTodo[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProposedTodo[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const title = (it as { title?: unknown }).title;
    if (typeof title !== "string") continue;
    const trimmed = title.trim();
    if (!trimmed) continue;
    const key = normKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = (it as { reason?: unknown }).reason;
    const project = (it as { project?: unknown }).project;
    out.push({
      title: trimmed,
      reason: typeof reason === "string" ? reason.trim() || undefined : undefined,
      when,
      project: typeof project === "string" && project.trim() ? project.trim() : undefined,
    });
  }
  return out;
}

export function filterPlanItems(raw: unknown): { today: ProposedTodo[]; later: ProposedTodo[] } {
  if (!raw || typeof raw !== "object") return { today: [], later: [] };
  const obj = raw as { today?: unknown; later?: unknown; items?: unknown };
  const today = asPlanBucket(obj.today ?? obj.items, "today");
  const todayNorm = new Set(today.map((t) => normKey(t.title)));
  const later = asPlanBucket(obj.later, "later").filter((t) => !todayNorm.has(normKey(t.title)));
  if (today.length <= MAX_TODAY_PLAN) return { today, later };
  const kept = today.slice(0, MAX_TODAY_PLAN);
  const spilled = today.slice(MAX_TODAY_PLAN).map((t) => ({ ...t, when: "later" as const }));
  const laterNorm = new Set(later.map((t) => normKey(t.title)));
  const extra = spilled.filter((t) => !laterNorm.has(normKey(t.title)));
  return { today: kept, later: [...extra, ...later] };
}
