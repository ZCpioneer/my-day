import { localDate } from "./dates";
import { normKey, titlesOverlap } from "./norm";
import { isOverdue } from "./todo-meta";
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

/** 今天桶里、创建日早于当天、还没勾掉：隔夜留下。 */
export function isLeftover(t: Pick<Todo, "status" | "when" | "sourceDate">, today: string): boolean {
  return t.status === "open" && todoWhen(t) === "today" && t.sourceDate < today;
}

/** 以后桶里、截止日期已过、还没勾掉：提到今天去。 */
export function isOverdueLater(t: Pick<Todo, "status" | "when" | "due">, today: string): boolean {
  return t.status === "open" && todoWhen(t) === "later" && isOverdue(t.due, today);
}

/** 编辑补丁：undefined 不动，null 清掉可选字段。 */
export type TodoPatch = {
  title?: string;
  when?: "today" | "later";
  projectId?: string | null;
  due?: string | null;
  estimate?: number | null;
  priority?: "high" | "normal" | null;
  reason?: string | null;
};

export function applyTodoPatch(todo: Todo, patch: TodoPatch): Todo {
  const next: Todo = { ...todo };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title) next.title = title;
  }
  if (patch.when !== undefined) next.when = patch.when;
  if (patch.projectId !== undefined) {
    if (patch.projectId) next.projectId = patch.projectId;
    else delete next.projectId;
  }
  if (patch.due !== undefined) {
    if (patch.due) next.due = patch.due;
    else delete next.due;
  }
  if (patch.estimate !== undefined) {
    if (patch.estimate && patch.estimate > 0) next.estimate = patch.estimate;
    else delete next.estimate;
  }
  if (patch.priority !== undefined) {
    if (patch.priority === "high") next.priority = "high";
    else delete next.priority;
  }
  if (patch.reason !== undefined) {
    const reason = patch.reason?.trim();
    if (reason) next.reason = reason;
    else delete next.reason;
  }
  return next;
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

type PlanRow = { title: string; projectId?: string; when: "today" | "later" };

/** 计划里互相包含的标题合成一条：留更长的；今天优先于以后。 */
function collapsePlanRows(rows: PlanRow[]): PlanRow[] {
  const out: PlanRow[] = [];
  for (const row of rows) {
    const title = row.title.trim();
    if (!title) continue;
    const idx = out.findIndex((o) => titlesOverlap(o.title, title));
    if (idx < 0) {
      out.push({ ...row, title });
      continue;
    }
    const prev = out[idx];
    const incomingLonger = normKey(title).length > normKey(prev.title).length;
    out[idx] = {
      title: incomingLonger ? title : prev.title,
      projectId: (incomingLonger ? row.projectId : prev.projectId) ?? (incomingLonger ? prev.projectId : row.projectId),
      when: prev.when === "today" || row.when === "today" ? "today" : "later",
    };
  }
  return out;
}

export function applyFullPlan(
  existing: Todo[],
  plan: { today: PlanEntry[]; later: PlanEntry[] },
  opts: { date: string; nowIso: string; newId: () => string },
): Todo[] {
  const rows = collapsePlanRows([
    ...plan.today.map(asEntry).map((e) => ({ ...e, when: "today" as const })),
    ...plan.later.map(asEntry).map((e) => ({ ...e, when: "later" as const })),
  ]);
  const next = existing.map((t) => ({ ...t }));
  const claimed = new Set<string>();

  const applyEntry = (entry: PlanRow) => {
    const title = entry.title.trim();
    if (!title) return;
    const openMatches = next.filter((t) => t.status === "open" && titlesOverlap(t.title, title));
    const free = openMatches.filter((t) => !claimed.has(t.id));
    if (openMatches.length > 0 && free.length === 0) {
      for (const t of openMatches) {
        if (normKey(title).length > normKey(t.title).length) t.title = title;
      }
      return;
    }
    if (free.length > 0) {
      const exact = free.find((t) => normKey(t.title) === normKey(title));
      const target =
        exact ?? free.reduce((a, b) => (normKey(a.title).length >= normKey(b.title).length ? a : b));
      claimed.add(target.id);
      target.when = entry.when;
      if (normKey(title).length > normKey(target.title).length) target.title = title;
      if (entry.projectId) target.projectId = entry.projectId;
      return;
    }
    // 已完成的同名不重新打开。包含关系不挡已完成，避免「支付宝」挡住另一件更长的新事。
    if (next.some((t) => normKey(t.title) === normKey(title))) return;
    const row: Todo = {
      id: opts.newId(),
      title,
      status: "open",
      sourceDate: opts.date,
      createdAt: opts.nowIso,
      when: entry.when,
    };
    if (entry.projectId) row.projectId = entry.projectId;
    next.push(row);
    claimed.add(row.id);
  };

  for (const entry of rows) applyEntry(entry);

  for (const t of next) {
    if (t.status !== "open" || claimed.has(t.id)) continue;
    if (todoWhen(t) === "today") t.when = "later";
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
