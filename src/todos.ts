import { localDate } from "./dates";
import { normKey } from "./norm";
import type { Todo } from "./types";

export function todoWhen(t: Pick<Todo, "when">): "today" | "later" {
  return t.when === "later" ? "later" : "today";
}

// 有 order 的按手动排位在前，没有的按创建时间兜底，最后按 id 保证稳定。
export function byOrder(a: Todo, b: Todo): number {
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
  const wantedNorm = new Set(wanted.map(normKey));
  const next = existing.map((t) => ({ ...t }));

  for (const t of next) {
    if (t.status !== "open") continue;
    if (wantedNorm.has(normKey(t.title))) t.when = "today";
    else if (todoWhen(t) === "today") t.when = "later";
  }

  const existingNorm = new Set(next.map((t) => normKey(t.title)));
  for (const title of wanted) {
    if (existingNorm.has(normKey(title))) continue;
    next.push({
      id: opts.newId(),
      title,
      status: "open",
      sourceDate: opts.date,
      createdAt: opts.nowIso,
      when: "today",
    });
    existingNorm.add(normKey(title));
  }
  return next;
}

// 整理计划的条目：裸标题，或带归属组 id（由调用方先把组名解析成 id）。
export type PlanEntry = string | { title: string; projectId?: string };

function asEntry(e: PlanEntry): { title: string; projectId?: string } {
  return typeof e === "string" ? { title: e } : e;
}

export function applyFullPlan(
  existing: Todo[],
  plan: { today: PlanEntry[]; later: PlanEntry[] },
  opts: { date: string; nowIso: string; newId: () => string },
): Todo[] {
  const todayWanted = plan.today
    .map(asEntry)
    .map((e) => ({ ...e, title: e.title.trim() }))
    .filter((e) => e.title);
  const todayNorm = new Set(todayWanted.map((e) => normKey(e.title)));
  const laterWanted = plan.later
    .map(asEntry)
    .map((e) => ({ ...e, title: e.title.trim() }))
    .filter((e) => e.title && !todayNorm.has(normKey(e.title)));
  const laterNorm = new Set(laterWanted.map((e) => normKey(e.title)));
  const projectOf = new Map<string, string | undefined>();
  for (const e of [...todayWanted, ...laterWanted]) projectOf.set(normKey(e.title), e.projectId);
  const next = existing.map((t) => ({ ...t }));

  for (const t of next) {
    if (t.status !== "open") continue;
    const key = normKey(t.title);
    if (todayNorm.has(key)) t.when = "today";
    else if (laterNorm.has(key)) t.when = "later";
    else if (todoWhen(t) === "today") t.when = "later";
    const pid = projectOf.get(key);
    if (pid !== undefined) t.projectId = pid;
  }

  const existingNorm = new Set(next.map((t) => normKey(t.title)));
  for (const [list, when] of [
    [todayWanted, "today"],
    [laterWanted, "later"],
  ] as const) {
    for (const e of list) {
      if (existingNorm.has(normKey(e.title))) continue;
      const row: Todo = {
        id: opts.newId(),
        title: e.title,
        status: "open",
        sourceDate: opts.date,
        createdAt: opts.nowIso,
        when,
      };
      if (e.projectId) row.projectId = e.projectId;
      next.push(row);
      existingNorm.add(normKey(e.title));
    }
  }
  return next;
}

// 拖拽落点：when=today 插进今天桶第 index 位；when=later 插进 projectId 组分区第 index 位
// （null = 未分组区，缺省 = 留在原组）。重写涉及序列的 order 为 0..n-1。找不到 id 时原样返回。
export function applyMove(
  existing: Todo[],
  id: string,
  to: { when: "today" | "later"; index: number; projectId?: string | null },
  date: string,
): Todo[] {
  const moved = existing.find((t) => t.id === id);
  if (!moved) return existing;
  const { today, later } = partitionTodos(existing, date);
  const toProject =
    to.when === "later" ? (to.projectId === undefined ? (moved.projectId ?? null) : to.projectId) : null;
  const fromKey = todoWhen(moved) === "today" ? "today" : `later:${moved.projectId ?? ""}`;
  const toKey = to.when === "today" ? "today" : `later:${toProject ?? ""}`;

  const inLane = (t: Todo, when: "today" | "later", projectId: string | null): boolean =>
    when === "today"
      ? todoWhen(t) === "today"
      : todoWhen(t) === "later" && (t.projectId ?? null) === projectId;

  const pool = to.when === "today" ? today : later;
  const target = pool.filter((t) => t.id !== id && inLane(t, to.when, toProject));
  const index = Math.max(0, Math.min(to.index, target.length));
  target.splice(index, 0, moved);
  const reordered = new Map<string, number>();
  target.forEach((t, i) => reordered.set(t.id, i));
  if (fromKey !== toKey) {
    const sourcePool = fromKey === "today" ? today : later;
    const source = sourcePool.filter(
      (t) => t.id !== id && inLane(t, fromKey === "today" ? "today" : "later", moved.projectId ?? null),
    );
    source.forEach((t, i) => reordered.set(t.id, i));
  }
  return existing.map((t) => {
    const order = reordered.get(t.id);
    if (order === undefined) return t;
    const nextRow: Todo = { ...t, order };
    if (t.id === id) {
      nextRow.when = to.when;
      if (to.when === "later") {
        if (toProject) nextRow.projectId = toProject;
        else delete nextRow.projectId;
      }
    }
    return nextRow;
  });
}
