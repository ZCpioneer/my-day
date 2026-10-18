import { normKey, titlesOverlap } from "./norm";
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

function longerTitle(a: string, b: string): string {
  return normKey(b).length > normKey(a).length ? b : a;
}

/** 互相包含的候选合成一条：留更长的标题；有一条在今天就进今天。 */
export function mergeOverlappingProposed(items: ProposedTodo[]): ProposedTodo[] {
  const out: ProposedTodo[] = [];
  for (const raw of items) {
    const title = raw.title.trim();
    if (!normKey(title)) continue;
    const idx = out.findIndex((o) => titlesOverlap(o.title, title));
    if (idx < 0) {
      out.push({ ...raw, title });
      continue;
    }
    const prev = out[idx];
    const incomingLonger = normKey(title).length > normKey(prev.title).length;
    const primary = incomingLonger ? raw : prev;
    const secondary = incomingLonger ? prev : raw;
    out[idx] = {
      ...secondary,
      ...primary,
      title: longerTitle(prev.title, title),
      when: prev.when === "today" || raw.when === "today" ? "today" : "later",
      project: primary.project ?? secondary.project,
      reason: primary.reason ?? secondary.reason,
      priority: primary.priority ?? secondary.priority,
      due: primary.due ?? secondary.due,
      estimate: primary.estimate ?? secondary.estimate,
    };
  }
  return out;
}

/**
 * 进确认框前丢掉已被清单盖住的候选。
 * 全字相同：未完成和已完成都挡。包含关系：只对未完成。
 * 同一批里互相包含时留更长的那句。
 */
export function withoutCoveredTitles(
  candidates: ProposedTodo[],
  existing: { title: string; status?: string }[],
): ProposedTodo[] {
  const exact = new Set(existing.map((t) => normKey(t.title)).filter(Boolean));
  const openTitles = existing.filter((t) => (t.status ?? "open") === "open").map((t) => t.title);
  const kept: ProposedTodo[] = [];
  for (const raw of candidates) {
    const title = raw.title.trim();
    const key = normKey(title);
    if (!key) continue;
    if (exact.has(key)) continue;
    if (openTitles.some((t) => titlesOverlap(t, title))) continue;
    const idx = kept.findIndex((k) => titlesOverlap(k.title, title));
    if (idx < 0) {
      kept.push({ ...raw, title });
      continue;
    }
    if (normKey(title).length > normKey(kept[idx].title).length) {
      kept[idx] = { ...kept[idx], ...raw, title };
    }
  }
  return kept;
}
