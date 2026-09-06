import { localDate } from "./dates";
import type { Todo } from "./types";

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function todoWhen(t: Pick<Todo, "when">): "today" | "later" {
  return t.when === "later" ? "later" : "today";
}

// 有 order 的按手动排位在前，没有的按创建时间兜底，最后按 id 保证稳定。
function byOrder(a: Todo, b: Todo): number {
  const oa = a.order;
  const ob = b.order;
  if (oa != null && ob != null && oa !== ob) return oa - ob;
  if (oa != null && ob == null) return -1;
  if (oa == null && ob != null) return 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isDoneOn(t: Todo, date: string): boolean {
  return t.status === "done" && !!t.completedAt && localDate(new Date(t.completedAt)) === date;
}

export function partitionTodos(todos: Todo[], date: string): {
  today: Todo[];
  later: Todo[];
  doneToday: Todo[];
} {
  const today: Todo[] = [];
  const later: Todo[] = [];
  const doneToday: Todo[] = [];
  for (const t of todos) {
    if (isDoneOn(t, date)) {
      doneToday.push(t);
      continue;
    }
    if (t.status !== "open") continue;
    if (todoWhen(t) === "today") today.push(t);
    else later.push(t);
  }
  today.sort(byOrder);
  later.sort(byOrder);
  doneToday.sort(byOrder);
  return { today, later, doneToday };
}

export function snapshotLogTitles(todos: Todo[], date: string): { done: string[]; undone: string[] } {
  const { today, doneToday } = partitionTodos(todos, date);
  return {
    undone: today.map((t) => t.title),
    done: doneToday.filter((t) => todoWhen(t) === "today").map((t) => t.title),
  };
}

export function applyTodayPlan(
  existing: Todo[],
  titles: string[],
  opts: { date: string; nowIso: string; newId: () => string },
): Todo[] {
  const wanted = titles.map((t) => t.trim()).filter(Boolean);
  const wantedNorm = new Set(wanted.map(norm));
  const next = existing.map((t) => ({ ...t }));

  for (const t of next) {
    if (t.status !== "open") continue;
    if (wantedNorm.has(norm(t.title))) t.when = "today";
    else if (todoWhen(t) === "today") t.when = "later";
  }

  const existingNorm = new Set(next.map((t) => norm(t.title)));
  for (const title of wanted) {
    if (existingNorm.has(norm(title))) continue;
    next.push({
      id: opts.newId(),
      title,
      status: "open",
      sourceDate: opts.date,
      createdAt: opts.nowIso,
      when: "today",
    });
    existingNorm.add(norm(title));
  }
  return next;
}

export function applyFullPlan(
  existing: Todo[],
  plan: { today: string[]; later: string[] },
  opts: { date: string; nowIso: string; newId: () => string },
): Todo[] {
  const todayWanted = plan.today.map((t) => t.trim()).filter(Boolean);
  const todayNorm = new Set(todayWanted.map(norm));
  const laterWanted = plan.later
    .map((t) => t.trim())
    .filter((t) => t && !todayNorm.has(norm(t)));
  const laterNorm = new Set(laterWanted.map(norm));
  const next = existing.map((t) => ({ ...t }));

  for (const t of next) {
    if (t.status !== "open") continue;
    const key = norm(t.title);
    if (todayNorm.has(key)) t.when = "today";
    else if (laterNorm.has(key)) t.when = "later";
    else if (todoWhen(t) === "today") t.when = "later";
  }

  const existingNorm = new Set(next.map((t) => norm(t.title)));
  for (const title of todayWanted) {
    if (existingNorm.has(norm(title))) continue;
    next.push({
      id: opts.newId(),
      title,
      status: "open",
      sourceDate: opts.date,
      createdAt: opts.nowIso,
      when: "today",
    });
    existingNorm.add(norm(title));
  }
  for (const title of laterWanted) {
    if (existingNorm.has(norm(title))) continue;
    next.push({
      id: opts.newId(),
      title,
      status: "open",
      sourceDate: opts.date,
      createdAt: opts.nowIso,
      when: "later",
    });
    existingNorm.add(norm(title));
  }
  return next;
}

// 拖拽落点：把 id 插进 to.when 桶的第 to.index 位（index 针对不含自身的序列），
// 重写涉及桶的 order 为 0..n-1。找不到 id 时原样返回。
export function applyMove(
  existing: Todo[],
  id: string,
  to: { when: "today" | "later"; index: number },
  date: string,
): Todo[] {
  const moved = existing.find((t) => t.id === id);
  if (!moved) return existing;
  const from = todoWhen(moved);
  const { today, later } = partitionTodos(existing, date);
  const target = (to.when === "today" ? today : later).filter((t) => t.id !== id);
  const index = Math.max(0, Math.min(to.index, target.length));
  target.splice(index, 0, moved);
  const reordered = new Map<string, number>();
  target.forEach((t, i) => reordered.set(t.id, i));
  if (from !== to.when) {
    const source = (from === "today" ? today : later).filter((t) => t.id !== id);
    source.forEach((t, i) => reordered.set(t.id, i));
  }
  return existing.map((t) => {
    const order = reordered.get(t.id);
    if (order === undefined) return t;
    const nextRow: Todo = { ...t, order };
    if (t.id === id) nextRow.when = to.when;
    return nextRow;
  });
}
