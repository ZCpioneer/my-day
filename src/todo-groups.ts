import { byOrder, todoWhen } from "./todos";
import type { Project, Todo } from "./types";

/** 「以后」栏的一个分区：某个项目组，或未分组区（project 为 null）。 */
export interface LaterSection {
  project: Project | null;
  /** 区内「以后」的未完成任务，按组内 order 排。 */
  todos: Todo[];
  /** 组内已完成总数（含历史、含今天勾掉的）。 */
  doneCount: number;
  /** 组内任务总数（不限 when / status）。 */
  totalCount: number;
}

// 有 order 的按手动排位在前，没有的按创建时间兜底，最后按 id 保证稳定。
function byProjectOrder(a: Project, b: Project): number {
  const oa = a.order;
  const ob = b.order;
  if (oa != null && ob != null && oa !== ob) return oa - ob;
  if (oa != null && ob == null) return -1;
  if (oa == null && ob != null) return 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 进行中的组（active / paused）在前按手动排位，已完成组沉底。 */
export function sortProjects(projects: Project[]): Project[] {
  const open = projects.filter((p) => p.status !== "done").sort(byProjectOrder);
  const done = projects.filter((p) => p.status === "done").sort(byProjectOrder);
  return [...open, ...done];
}

/** 「以后」栏分区：进行中组（有以后任务才显示）→ 未分组区 → 已完成组（沉底，空也显示）。 */
export function partitionLater(todos: Todo[], projects: Project[]): LaterSection[] {
  const sections: LaterSection[] = [];
  const known = new Set(projects.map((p) => p.id));
  for (const p of sortProjects(projects)) {
    const mine = todos.filter((t) => t.projectId === p.id);
    const open = mine.filter((t) => t.status === "open" && todoWhen(t) === "later").sort(byOrder);
    if (open.length === 0 && p.status !== "done") continue;
    sections.push({
      project: p,
      todos: open,
      doneCount: mine.filter((t) => t.status === "done").length,
      totalCount: mine.length,
    });
  }
  const stray = todos
    .filter((t) => t.status === "open" && todoWhen(t) === "later" && (!t.projectId || !known.has(t.projectId)))
    .sort(byOrder);
  if (stray.length > 0) {
    const ungrouped: LaterSection = { project: null, todos: stray, doneCount: 0, totalCount: stray.length };
    const doneStart = sections.findIndex((s) => s.project?.status === "done");
    if (doneStart < 0) sections.push(ungrouped);
    else sections.splice(doneStart, 0, ungrouped);
  }
  return sections;
}

/** 组状态随任务自动流转：active→done（最后一条勾掉）、done→active（来了新活）。paused 不动。 */
export function syncProjectStatuses(projects: Project[], todos: Todo[], nowIso: string): Project[] {
  return projects.map((p) => {
    const mine = todos.filter((t) => t.projectId === p.id);
    const hasOpen = mine.some((t) => t.status === "open");
    if (p.status === "active" && mine.length > 0 && !hasOpen) {
      return { ...p, status: "done" as const, updatedAt: nowIso };
    }
    if (p.status === "done" && hasOpen) {
      return { ...p, status: "active" as const, updatedAt: nowIso };
    }
    return p;
  });
}

/** 组排序：把 id 插进非 done 组序列的第 index 位，重写这些组的 order。找不到或拖 done 组原样返回。 */
export function applyProjectMove(projects: Project[], id: string, index: number): Project[] {
  const moved = projects.find((p) => p.id === id);
  if (!moved || moved.status === "done") return projects;
  const lane = sortProjects(projects).filter((p) => p.status !== "done" && p.id !== id);
  const i = Math.max(0, Math.min(index, lane.length));
  lane.splice(i, 0, moved);
  const reordered = new Map<string, number>();
  lane.forEach((p, n) => reordered.set(p.id, n));
  return projects.map((p) => {
    const order = reordered.get(p.id);
    return order === undefined ? p : { ...p, order };
  });
}
