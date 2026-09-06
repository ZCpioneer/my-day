# 待办按项目分组（父组 + 子任务）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 待办页「以后」栏按项目分区展示（组标题 + 进度 + 折叠 + 组内/跨组拖拽 + 组排序），确认框按组分组，组随任务自动完成/重激活。

**Architecture:** 组 = 复用现有 `Project`（不新建实体、不加 parentId 树、DB 不升版本）。分组/进度/状态同步/组排序全部做成纯函数（新模块 `src/todo-groups.ts` + 扩展 `src/todos.ts` 的 `applyMove`），仓储层薄封装，UI（TodoScreen / TodoConfirm / 新组件 GroupSheet）只做展示与事件转发。

**Tech Stack:** Vue 3 `<script setup lang="ts">` + TypeScript strict + vitest（happy-dom + fake-indexeddb）+ IndexedDB（DB v2 不变）。

**Spec:** `docs/superpowers/specs/2026-09-06-todo-project-groups-design.md`

## Global Constraints

- 注释、提交信息、面向用户的文案一律中文。
- 业务规则写成不依赖框架的纯函数；仓储、网络、时间通过参数注入。
- `@/` 别名指向 `src/`；测试全部在 `src/__tests__/`，命名与被测模块同名。
- IndexedDB 保持 DB v2，不升版本；新字段一律可选字段兜底兼容旧数据。
- 「今天」桶保持平铺不分区；日记快照、`set_today_plan`、`applyTodayPlan` / `applyFullPlan`、上下文注入全部不动。
- 每个 Task 完成后跑 `npm run test`；全部完成后跑 `npm run test` 和 `npm run build`。

---

### Task 1: 纯函数模块 `src/todo-groups.ts`（分组、进度、状态同步、组排序）

**Files:**
- Create: `src/todo-groups.ts`
- Modify: `src/todos.ts`（`byOrder` 加 `export`）
- Test: `src/__tests__/todo-groups.test.ts`

**Interfaces:**
- Consumes: `todoWhen`（`@/todos` 已有）、`byOrder`（本任务导出）、`Project` / `Todo`（`@/types`）
- Produces:
  - `interface LaterSection { project: Project | null; todos: Todo[]; doneCount: number; totalCount: number }`
  - `sortProjects(projects: Project[]): Project[]`
  - `partitionLater(todos: Todo[], projects: Project[]): LaterSection[]`
  - `syncProjectStatuses(projects: Project[], todos: Todo[], nowIso: string): Project[]`
  - `applyProjectMove(projects: Project[], id: string, index: number): Project[]`

- [ ] **Step 1: `byOrder` 导出**

`src/todos.ts` 第 13 行 `function byOrder` 改为 `export function byOrder`，函数体不动。

- [ ] **Step 2: 写失败测试**

新建 `src/__tests__/todo-groups.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { sortProjects, partitionLater, syncProjectStatuses, applyProjectMove } from "@/todo-groups";
import type { Project, Todo } from "@/types";

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: partial.id,
    status: "open",
    sourceDate: "2026-09-06",
    createdAt: "2026-09-06T01:00:00.000Z",
    ...partial,
  };
}

function project(partial: Partial<Project> & { id: string }): Project {
  return {
    title: partial.id,
    status: "active",
    createdAt: "2026-09-06T01:00:00.000Z",
    updatedAt: "2026-09-06T01:00:00.000Z",
    ...partial,
  };
}

describe("sortProjects", () => {
  it("有 order 的在前，缺失按 createdAt 兜底；done 组沉底", () => {
    const ps = [
      project({ id: "c", createdAt: "2026-09-03T00:00:00.000Z" }),
      project({ id: "a", order: 1 }),
      project({ id: "done1", status: "done", order: 0 }),
      project({ id: "b", order: 0 }),
    ];
    expect(sortProjects(ps).map((p) => p.id)).toEqual(["b", "a", "c", "done1"]);
  });
});

describe("partitionLater", () => {
  it("组内只放 when=later 的未完成任务，进度含历史已完成", () => {
    const ps = [project({ id: "p1" })];
    const ts = [
      todo({ id: "t1", projectId: "p1", when: "later" }),
      todo({ id: "t2", projectId: "p1", when: "today" }),
      todo({ id: "t3", projectId: "p1", status: "done", completedAt: "2026-09-01T01:00:00.000Z" }),
    ];
    const [s] = partitionLater(ts, ps);
    expect(s.project?.id).toBe("p1");
    expect(s.todos.map((t) => t.id)).toEqual(["t1"]);
    expect(s.doneCount).toBe(1);
    expect(s.totalCount).toBe(3);
  });

  it("未分组区在进行中组之后、已完成组之前；无进行中组时排最前", () => {
    const ps = [project({ id: "p1" }), project({ id: "p2", status: "done" })];
    const ts = [
      todo({ id: "t1", projectId: "p1", when: "later" }),
      todo({ id: "t9", when: "later" }),
      todo({ id: "t8", projectId: "p2", status: "done", completedAt: "2026-09-01T01:00:00.000Z" }),
    ];
    const keys = partitionLater(ts, ps).map((s) => s.project?.id ?? "ungrouped");
    expect(keys).toEqual(["p1", "ungrouped", "p2"]);
  });

  it("已完成组没有未完成任务也显示（沉底）；进行中组没有以后任务则不显示", () => {
    const ps = [project({ id: "p1" }), project({ id: "p2", status: "done" })];
    const ts = [
      todo({ id: "t1", projectId: "p1", when: "today" }),
      todo({ id: "t2", projectId: "p2", status: "done", completedAt: "2026-09-01T01:00:00.000Z" }),
    ];
    const keys = partitionLater(ts, ps).map((s) => s.project?.id ?? "ungrouped");
    expect(keys).toEqual(["p2"]);
  });

  it("projectId 指向不存在的组时进未分组区", () => {
    const ts = [todo({ id: "t1", projectId: "ghost", when: "later" })];
    const [s] = partitionLater(ts, []);
    expect(s.project).toBeNull();
    expect(s.todos.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("syncProjectStatuses", () => {
  it("active 组最后一条 open 勾掉后自动 done", () => {
    const ps = [project({ id: "p1" })];
    const ts = [todo({ id: "t1", projectId: "p1", status: "done", completedAt: "2026-09-06T02:00:00.000Z" })];
    const [p] = syncProjectStatuses(ps, ts, "2026-09-06T03:00:00.000Z");
    expect(p.status).toBe("done");
    expect(p.updatedAt).toBe("2026-09-06T03:00:00.000Z");
  });

  it("没有任何任务的 active 组不自动 done", () => {
    const [p] = syncProjectStatuses([project({ id: "p1" })], [], "2026-09-06T03:00:00.000Z");
    expect(p.status).toBe("active");
  });

  it("done 组来了 open 任务自动重激活", () => {
    const ps = [project({ id: "p1", status: "done" })];
    const ts = [todo({ id: "t1", projectId: "p1" })];
    const [p] = syncProjectStatuses(ps, ts, "2026-09-06T03:00:00.000Z");
    expect(p.status).toBe("active");
  });

  it("paused 组不自动流转；无变化的组返回原引用", () => {
    const paused = project({ id: "p1", status: "paused" });
    const ts = [todo({ id: "t1", projectId: "p1", status: "done", completedAt: "2026-09-06T02:00:00.000Z" })];
    const [p] = syncProjectStatuses([paused], ts, "2026-09-06T03:00:00.000Z");
    expect(p).toBe(paused);
  });
});

describe("applyProjectMove", () => {
  it("在非 done 组序列里重排，重写 order 为 0..n-1", () => {
    const ps = [project({ id: "a" }), project({ id: "b" }), project({ id: "c" })];
    const next = applyProjectMove(ps, "a", 2);
    expect(next.find((p) => p.id === "b")?.order).toBe(0);
    expect(next.find((p) => p.id === "c")?.order).toBe(1);
    expect(next.find((p) => p.id === "a")?.order).toBe(2);
  });

  it("index 夹紧到序列范围；done 组不可拖、找不到 id 原样返回", () => {
    const ps = [project({ id: "a" }), project({ id: "b", status: "done" })];
    expect(applyProjectMove(ps, "b", 0)).toBe(ps);
    expect(applyProjectMove(ps, "ghost", 0)).toBe(ps);
    const next = applyProjectMove(ps, "a", 99);
    expect(next.find((p) => p.id === "a")?.order).toBe(0);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/__tests__/todo-groups.test.ts`
Expected: FAIL（`@/todo-groups` 模块不存在）

- [ ] **Step 4: 实现 `src/todo-groups.ts`**

```ts
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
```

`src/types.ts` 的 `Project` 接口加可选字段（放在 `note?` 后面）：

```ts
  /** 组手动排位；缺失时按 createdAt 兜底（兼容旧数据）。 */
  order?: number;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/__tests__/todo-groups.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 6: Commit**

```bash
git add src/todo-groups.ts src/todos.ts src/types.ts src/__tests__/todo-groups.test.ts
git commit -m "feat: 项目分组纯函数（分区、进度、状态同步、组排序）"
```

---

### Task 2: `applyMove` 扩展支持目标组

**Files:**
- Modify: `src/todos.ts`（`applyMove`）
- Test: `src/__tests__/todos.test.ts`

**Interfaces:**
- Consumes: Task 1 导出的 `byOrder`（同文件内）
- Produces: `applyMove(existing: Todo[], id: string, to: { when: "today" | "later"; index: number; projectId?: string | null }, date: string): Todo[]`
  - `when: "later"` 时 `projectId` 语义：`string` = 移入该组；`null` = 移入未分组区（删掉 `projectId` 字段）；`undefined`（缺省）= 留在原组。
  - `when: "today"` 时忽略 `projectId`，任务自己的 `projectId` 保留。

- [ ] **Step 1: 写失败测试**

在 `src/__tests__/todos.test.ts` 末尾追加（文件已有的 import 不变，复用其 helper；若文件里没有 helper 就带上下面这个）：

```ts
describe("applyMove 带目标组", () => {
  const base: Todo[] = [
    { id: "a1", title: "a1", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", when: "later", projectId: "p1" },
    { id: "a2", title: "a2", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T02:00:00.000Z", when: "later", projectId: "p1" },
    { id: "b1", title: "b1", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T03:00:00.000Z", when: "later", projectId: "p2" },
    { id: "u1", title: "u1", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T04:00:00.000Z", when: "later" },
    { id: "t1", title: "t1", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T05:00:00.000Z", when: "today", projectId: "p1" },
  ];
  const date = "2026-09-06";

  it("移入别的组：改 projectId，两个组的 order 都重写", () => {
    const next = applyMove(base, "b1", { when: "later", index: 1, projectId: "p1" }, date);
    const b1 = next.find((t) => t.id === "b1")!;
    expect(b1.projectId).toBe("p1");
    expect(next.find((t) => t.id === "a1")?.order).toBe(0);
    expect(b1.order).toBe(1);
    expect(next.find((t) => t.id === "a2")?.order).toBe(2);
    // u1 不在涉及序列里，拿不到 order
    expect(next.find((t) => t.id === "u1")?.order).toBeUndefined();
  });

  it("projectId 为 null 移入未分组区：删掉 projectId 字段", () => {
    const next = applyMove(base, "a1", { when: "later", index: 0, projectId: null }, date);
    const a1 = next.find((t) => t.id === "a1")!;
    expect("projectId" in a1).toBe(false);
    expect(a1.when).toBe("later");
  });

  it("projectId 缺省 = 留在原组，只做组内排序", () => {
    const next = applyMove(base, "a1", { when: "later", index: 1 }, date);
    const a1 = next.find((t) => t.id === "a1")!;
    expect(a1.projectId).toBe("p1");
    expect(next.find((t) => t.id === "a2")?.order).toBe(0);
    expect(a1.order).toBe(1);
    // 别组不受影响
    expect(next.find((t) => t.id === "b1")?.order).toBeUndefined();
  });

  it("从今天拖进以后的指定组", () => {
    const next = applyMove(base, "t1", { when: "later", index: 0, projectId: "p2" }, date);
    const t1 = next.find((t) => t.id === "t1")!;
    expect(t1.when).toBe("later");
    expect(t1.projectId).toBe("p2");
    expect(t1.order).toBe(0);
    expect(next.find((t) => t.id === "b1")?.order).toBe(1);
  });

  it("从以后拖回今天：保留 projectId", () => {
    const next = applyMove(base, "a1", { when: "today", index: 1 }, date);
    const a1 = next.find((t) => t.id === "a1")!;
    expect(a1.when).toBe("today");
    expect(a1.projectId).toBe("p1");
  });
});
```

（若 `todos.test.ts` 顶部没有 `Todo` 类型 import，补 `import type { Todo } from "@/types";`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/todos.test.ts`
Expected: 新用例 FAIL（现有 applyMove 不认 projectId）

- [ ] **Step 3: 重写 `applyMove`**

把 `src/todos.ts` 里的 `applyMove` 整个替换为：

```ts
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
```

文件顶部 `applyMove` 前的旧注释（`// 拖拽落点：把 id 插进 to.when 桶的第 to.index 位…`）一并替换掉。

- [ ] **Step 4: 跑测试确认通过（含旧用例不回归）**

Run: `npx vitest run src/__tests__/todos.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/todos.ts src/__tests__/todos.test.ts
git commit -m "feat: applyMove 支持拖入指定项目组"
```

---

### Task 3: 仓储层（`todoRepo.move` 带组、`setProject`、`projectRepo.put/move`）

**Files:**
- Modify: `src/storage/db.ts`
- Test: `src/__tests__/db.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `applyMove`、Task 1 的 `applyProjectMove`
- Produces:
  - `todoRepo.move(id: string, when: "today" | "later", index: number, opts?: { projectId?: string | null }, now?: Date): Promise<void>`
  - `todoRepo.setProject(id: string, projectId: string | null): Promise<void>`（找不到抛 `"todo not found"`）
  - `projectRepo.put(p: Project): Promise<void>`
  - `projectRepo.move(id: string, index: number): Promise<void>`

- [ ] **Step 1: 写失败测试**

先看 `src/__tests__/db.test.ts` 现有写法（fake-indexeddb 由 `setup.ts` 引入，直接用真仓储），在文件末尾追加：

```ts
describe("todoRepo.move 带目标组 / setProject", () => {
  it("move 带 projectId 会改归属", async () => {
    await deleteDb();
    await todoRepo.add({
      id: "a1", title: "a1", status: "open", sourceDate: "2026-09-06",
      createdAt: "2026-09-06T01:00:00.000Z", when: "later", projectId: "p1",
    });
    await todoRepo.move("a1", "later", 0, { projectId: "p2" }, new Date("2026-09-06T08:00:00.000Z"));
    const t = (await todoRepo.list()).find((x) => x.id === "a1")!;
    expect(t.projectId).toBe("p2");
  });

  it("setProject 设置与清除；找不到抛错", async () => {
    await deleteDb();
    await todoRepo.add({
      id: "a1", title: "a1", status: "open", sourceDate: "2026-09-06",
      createdAt: "2026-09-06T01:00:00.000Z", when: "later",
    });
    await todoRepo.setProject("a1", "p1");
    expect((await todoRepo.list())[0].projectId).toBe("p1");
    await todoRepo.setProject("a1", null);
    expect("projectId" in (await todoRepo.list())[0]).toBe(false);
    await expect(todoRepo.setProject("ghost", "p1")).rejects.toThrow("todo not found");
  });
});

describe("projectRepo.put / move", () => {
  it("put 直写；move 重写非 done 组 order", async () => {
    await deleteDb();
    const a = await projectRepo.upsertByTitle("甲", {});
    const b = await projectRepo.upsertByTitle("乙", {});
    await projectRepo.put({ ...b, note: "进展" });
    expect((await projectRepo.list()).find((p) => p.id === b.id)?.note).toBe("进展");
    await projectRepo.move(b.id, 0);
    const list = await projectRepo.list();
    expect(list.find((p) => p.id === b.id)?.order).toBe(0);
    expect(list.find((p) => p.id === a.id)?.order).toBe(1);
  });
});
```

（若顶部缺 import，补 `todoRepo` / `projectRepo` / `deleteDb`——按文件现有 import 调整。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/db.test.ts`
Expected: FAIL（`setProject` / `projectRepo.put` / `projectRepo.move` 不存在）

- [ ] **Step 3: 实现仓储改动**

`src/storage/db.ts` 三处：

1) `todoRepo.move` 换签名（替换原方法）：

```ts
  async move(
    id: string,
    when: "today" | "later",
    index: number,
    opts?: { projectId?: string | null },
    now: Date = new Date(),
  ): Promise<void> {
    const existing = await todoRepo.list();
    const next = applyMove(existing, id, { when, index, projectId: opts?.projectId }, localDate(now));
    if (next === existing) return;
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    for (const todo of next) store.put(todo);
    await txDone(tx);
    db.close();
  },
  async setProject(id: string, projectId: string | null): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    const todo = await new Promise<Todo>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as Todo);
      req.onerror = () => reject(req.error);
    });
    if (!todo) throw new Error("todo not found");
    if (projectId) todo.projectId = projectId;
    else delete todo.projectId;
    store.put(todo);
    await txDone(tx);
    db.close();
  },
```

2) `projectRepo` 末尾（`upsertByTitle` 之后）加：

```ts
  async put(p: Project): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(p);
    await txDone(tx);
    db.close();
  },
  async move(id: string, index: number): Promise<void> {
    const existing = await projectRepo.list();
    const next = applyProjectMove(existing, id, index);
    if (next === existing) return;
    const changed = next.filter((p, i) => p !== existing[i]);
    if (changed.length === 0) return;
    const db = await openDb();
    const tx = db.transaction("projects", "readwrite");
    const store = tx.objectStore("projects");
    for (const p of changed) store.put(p);
    await txDone(tx);
    db.close();
  },
```

3) 顶部 import 加 `applyProjectMove`：

```ts
import { applyProjectMove } from "../todo-groups";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/__tests__/db.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/db.ts src/__tests__/db.test.ts
git commit -m "feat: 仓储层支持任务改组与组排序"
```

---

### Task 4: 折叠状态存储

**Files:**
- Modify: `src/storage/settings.ts`
- Test: `src/__tests__/settings.test.ts`

**Interfaces:**
- Produces:
  - `loadCollapsedGroups(prefs?: Prefs): Promise<string[]>`
  - `saveCollapsedGroups(ids: string[], prefs?: Prefs): Promise<void>`
  - 存独立 prefs key `zhaomu.collapsed-groups`，不进 `Settings` 对象。未分组区的 key 用空字符串 `""`。

- [ ] **Step 1: 写失败测试**

`src/__tests__/settings.test.ts` 末尾追加：

```ts
describe("collapsedGroups", () => {
  it("roundtrip；空串 key（未分组区）也能存", async () => {
    mem.clear();
    expect(await loadCollapsedGroups(prefs)).toEqual([]);
    await saveCollapsedGroups(["p1", ""], prefs);
    expect(await loadCollapsedGroups(prefs)).toEqual(["p1", ""]);
  });

  it("损坏内容回退空数组", async () => {
    mem.clear();
    mem.set("zhaomu.collapsed-groups", "{oops");
    expect(await loadCollapsedGroups(prefs)).toEqual([]);
    mem.set("zhaomu.collapsed-groups", "[1,2]");
    expect(await loadCollapsedGroups(prefs)).toEqual([]);
  });
});
```

顶部 import 加 `loadCollapsedGroups, saveCollapsedGroups`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/settings.test.ts`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 实现**

`src/storage/settings.ts` 末尾追加：

```ts
const COLLAPSED_KEY = "zhaomu.collapsed-groups";

/** 「以后」栏各分区的折叠状态（组 id 列表；未分组区用空串）。 */
export async function loadCollapsedGroups(prefs: Prefs = defaultPrefs()): Promise<string[]> {
  const raw = await prefs.get(COLLAPSED_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveCollapsedGroups(ids: string[], prefs: Prefs = defaultPrefs()): Promise<void> {
  await prefs.set(COLLAPSED_KEY, JSON.stringify(ids));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/__tests__/settings.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/settings.ts src/__tests__/settings.test.ts
git commit -m "feat: 分组折叠状态存 Preferences"
```

---

### Task 5: TodoScreen「以后」分区渲染（组标题、进度、折叠）

**Files:**
- Modify: `src/screens/TodoScreen.vue`
- Modify: `src/styles.css`
- Test: `src/__tests__/todos-screen.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `partitionLater` / `LaterSection`、Task 4 的 `loadCollapsedGroups` / `saveCollapsedGroups`
- Produces: 模板结构 `[data-bucket=later] > [data-group="<projectId 或空串>"] > .group-head + TodoRow…`，供 Task 6/7 的拖拽命中使用；done 组带 `data-done="1"`。

- [ ] **Step 1: 写失败测试**

`src/__tests__/todos-screen.test.ts` 末尾追加：

```ts
describe("TodoScreen 项目分区", () => {
  const groupedTodos: Todo[] = [
    { id: "g1", title: "找房", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", when: "later", projectId: "p1" },
    { id: "g2", title: "打包", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T02:00:00.000Z", when: "later", projectId: "p1" },
    { id: "g3", title: "已做完", status: "done", sourceDate: "2026-09-06", createdAt: "2026-09-06T03:00:00.000Z", completedAt: "2026-09-05T10:00:00.000Z", when: "later", projectId: "p1" },
    { id: "u1", title: "零散事", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T04:00:00.000Z", when: "later" },
  ];
  const groupedProjects: Project[] = [
    { id: "p1", title: "搬家", status: "active", createdAt: "2026-09-06T01:00:00.000Z", updatedAt: "2026-09-06T01:00:00.000Z" },
    { id: "p2", title: "发布会", status: "done", createdAt: "2026-09-05T01:00:00.000Z", updatedAt: "2026-09-05T02:00:00.000Z" },
  ];

  it("以后栏按组分区：组名、进度、未分组区、已完成组沉底灰显", async () => {
    localStorage.clear();
    const w = mount(TodoScreen, { props: { todos: groupedTodos, projects: groupedProjects } });
    await flushPromises();
    const keys = w.findAll("[data-group]").map((el) => el.attributes("data-group"));
    expect(keys).toEqual(["p1", "", "p2"]);
    expect(w.get("[data-group=p1]").text()).toContain("搬家");
    expect(w.get("[data-group=p1]").text()).toContain("1/3");
    expect(w.get("[data-group=p1]").text()).toContain("找房");
    expect(w.get("[data-group='']").text()).toContain("未分组");
    expect(w.get("[data-group='']").text()).toContain("零散事");
    const doneHead = w.get("[data-group=p2] .group-head");
    expect(doneHead.text()).toContain("发布会");
    expect(doneHead.classes()).toContain("done");
  });

  it("点组标题折叠/展开，状态写进 localStorage", async () => {
    localStorage.clear();
    const w = mount(TodoScreen, { props: { todos: groupedTodos, projects: groupedProjects } });
    await flushPromises();
    await w.get("[data-group=p1] .group-head").trigger("click");
    expect(w.find("[data-group=p1] [data-todo=g1]").exists()).toBe(false);
    expect(JSON.parse(localStorage.getItem("zhaomu.collapsed-groups")!)).toContain("p1");
    const w2 = mount(TodoScreen, { props: { todos: groupedTodos, projects: groupedProjects } });
    await flushPromises();
    expect(w2.find("[data-group=p1] [data-todo=g1]").exists()).toBe(false);
  });
});
```

顶部 import 加 `flushPromises`（从 `@vue/test-utils`，与 `mount` 同行）和 `import type { Project, Todo } from "@/types";`（替换原有的 `import type { Todo } from "@/types";`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/todos-screen.test.ts`
Expected: FAIL（没有 `[data-group]` 元素）

- [ ] **Step 3: 改 TodoScreen 模板与脚本**

模板里 `data-bucket="later"` 的整个 `div.todo-bucket` 替换为：

```html
      <div
        class="todo-bucket"
        data-bucket="later"
        :class="{ 'drop-end': insert?.bucket === 'later' && insert.beforeId === null && !insert.group }"
      >
        <div class="section-label">以后</div>
        <div
          v-for="section in laterSections"
          :key="section.project?.id ?? 'ungrouped'"
          class="todo-group"
          :data-group="section.project?.id ?? ''"
          :data-done="section.project?.status === 'done' ? '1' : undefined"
          :class="{
            'drop-end':
              insert?.bucket === 'later' &&
              insert.beforeId === null &&
              (insert.group ?? '') === (section.project?.id ?? '') &&
              !!insert.group,
          }"
        >
          <div
            class="group-head"
            :class="{ done: section.project?.status === 'done' }"
            @click="onGroupClick(section)"
          >
            <span class="group-name">{{ section.project?.title ?? "未分组" }}</span>
            <span v-if="section.project" class="group-progress">
              {{ section.doneCount }}/{{ section.totalCount }}
            </span>
            <span class="group-arrow">{{ isCollapsed(section) ? "▸" : "▾" }}</span>
          </div>
          <template v-if="!isCollapsed(section)">
            <TodoRow
              v-for="t in section.todos"
              :key="t.id"
              :todo="t"
              :project-title="projectTitles.get(t.projectId ?? '')"
              :class="{ 'drop-before': insert?.bucket === 'later' && insert.beforeId === t.id }"
              :revealed="openId === t.id"
              @toggle="emit('toggle', $event)"
              @remove="emit('remove', $event)"
              @reveal="openId = $event"
              @lift="onLift"
              @drag="onDrag"
              @drop="onDrop"
            />
          </template>
        </div>
        <p v-if="later.length === 0" class="empty" style="margin: 8px 0">没有记着的事。</p>
      </div>
```

脚本改动：

```ts
import { computed, onMounted, ref } from "vue";
import { partitionLater, type LaterSection } from "@/todo-groups";
import { loadCollapsedGroups, saveCollapsedGroups } from "@/storage/settings";
```

`insert` 的类型改为：

```ts
const insert = ref<{ bucket: PlanBucket; group: string | null; beforeId: string | null } | null>(null);
```

新增：

```ts
const laterSections = computed(() => partitionLater(props.todos, props.projects ?? []));

const collapsed = ref<Set<string>>(new Set());
onMounted(async () => {
  collapsed.value = new Set(await loadCollapsedGroups());
});

function sectionKey(s: LaterSection): string {
  return s.project?.id ?? "";
}

function isCollapsed(s: LaterSection): boolean {
  return collapsed.value.has(sectionKey(s));
}

async function onGroupClick(s: LaterSection) {
  if (liftId.value) return;
  const key = sectionKey(s);
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
  await saveCollapsedGroups([...next]);
}
```

- [ ] **Step 4: 加样式**

`src/styles.css` 在 `.section-label` 规则后追加：

```css
.todo-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: 14px;
}
.todo-group > * { flex-shrink: 0; }
.group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 4px 0;
  cursor: pointer;
  user-select: none;
}
.group-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--paper);
}
.group-head.done .group-name {
  color: var(--mute);
  text-decoration: line-through;
}
.group-progress {
  font-size: 11px;
  color: var(--dawn);
}
.group-arrow {
  margin-left: auto;
  font-size: 11px;
  color: var(--mute);
}
.todo-group.drop-end::after {
  content: "";
  height: 0;
  border-top: 3px solid var(--dawn);
  margin: -12px 4px 0;
}
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run src/__tests__/todos-screen.test.ts`
Expected: 新用例 PASS；旧的拖拽用例此时可能 FAIL（`measureInsert` 还没认组）——属预期，Task 6 修。

- [ ] **Step 6: Commit**

```bash
git add src/screens/TodoScreen.vue src/styles.css src/__tests__/todos-screen.test.ts
git commit -m "feat: 待办页以后栏按项目分区（标题、进度、折叠）"
```

---

### Task 6: TodoScreen 任务拖拽接线（组内 / 跨组 / 落空回自己组）

**Files:**
- Modify: `src/screens/TodoScreen.vue`
- Modify: `src/App.vue`（`onMove` 多接一个参数）
- Test: `src/__tests__/todos-screen.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `[data-group]` 结构
- Produces:
  - TodoScreen emit `move: [id: string, when: PlanBucket, index: number, projectId?: string | null]`（`when` 为 `"later"` 时必带第 4 参：`string` = 目标组，`null` = 未分组区）
  - App `onMove(id, when, index, projectId?)` → `todoRepo.move(id, when, index, { projectId })`

- [ ] **Step 1: 更新旧断言 + 写新失败测试**

`src/__tests__/todos-screen.test.ts`：

1) 两个旧用例的断言 `expect(w.emitted("move")?.[0]).toEqual(["t1", "later", 1])` 改为 `toEqual(["t1", "later", 1, null])`，并在各自 `mockRect` 调用后补一行：

```ts
    mockRect(w.get("[data-group='']").element as HTMLElement, 120, 300);
```

（t2 无组 → 以后栏只有未分组区；落点 y=180 命中该区。）

2) 末尾追加新用例：

```ts
describe("TodoScreen 跨组拖拽", () => {
  const crossTodos: Todo[] = [
    { id: "a1", title: "a1", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", when: "later", projectId: "p1" },
    { id: "b1", title: "b1", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T02:00:00.000Z", when: "later", projectId: "p2" },
  ];
  const crossProjects: Project[] = [
    { id: "p1", title: "甲", status: "active", createdAt: "2026-09-06T01:00:00.000Z", updatedAt: "2026-09-06T01:00:00.000Z" },
    { id: "p2", title: "乙", status: "active", createdAt: "2026-09-06T02:00:00.000Z", updatedAt: "2026-09-06T02:00:00.000Z" },
  ];

  it("拖进别的组的分区：emit 带目标 projectId", async () => {
    localStorage.clear();
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos: crossTodos, projects: crossProjects } });
    await flushPromises();
    mockRect(w.get("[data-bucket=today]").element as HTMLElement, 0, 50);
    mockRect(w.get("[data-bucket=later]").element as HTMLElement, 50, 400);
    mockRect(w.get("[data-group=p1]").element as HTMLElement, 50, 150);
    mockRect(w.get("[data-group=p2]").element as HTMLElement, 150, 400);
    mockRect(w.get("[data-todo=b1]").element as HTMLElement, 200, 260);

    const row = w.get("[data-todo=a1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 80, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    // 落进 p2 分区、b1 中点（230）之上 → p2 组第 0 位
    await row.trigger("pointermove", { clientX: 40, clientY: 180, pointerId: 1 });
    await row.trigger("pointerup", { clientX: 40, clientY: 180, pointerId: 1 });
    expect(w.emitted("move")?.[0]).toEqual(["a1", "later", 0, "p2"]);
  });

  it("落在以后栏空白处：回自己组排末尾", async () => {
    localStorage.clear();
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos: crossTodos, projects: crossProjects } });
    await flushPromises();
    mockRect(w.get("[data-bucket=today]").element as HTMLElement, 0, 50);
    mockRect(w.get("[data-bucket=later]").element as HTMLElement, 50, 600);
    mockRect(w.get("[data-group=p1]").element as HTMLElement, 50, 150);
    mockRect(w.get("[data-group=p2]").element as HTMLElement, 150, 300);

    const row = w.get("[data-todo=a1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 80, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    // 两分区之下的空白（y=500 不在任何 data-group 内）
    await row.trigger("pointermove", { clientX: 40, clientY: 500, pointerId: 1 });
    await row.trigger("pointerup", { clientX: 40, clientY: 500, pointerId: 1 });
    const args = w.emitted("move")?.[0];
    expect(args?.[0]).toBe("a1");
    expect(args?.[1]).toBe("later");
    expect(args?.[3]).toBe("p1");
    // index 越界由 applyMove 夹紧到组末尾
    expect(typeof args?.[2]).toBe("number");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/todos-screen.test.ts`
Expected: 新用例 FAIL（emit 还没有第 4 参 / 落空逻辑不存在）

- [ ] **Step 3: 改 measureInsert 与 onDrop**

`src/screens/TodoScreen.vue` 里 `measureInsert` 整个替换为：

```ts
// 量出落点：今天桶照旧按全桶行算；以后栏先命中分区（data-group），
// 落空处回被拖行自己的组（无组 = 未分组区），index 越界交给 applyMove 夹紧。
function measureInsert(bucket: PlanBucket, clientY: number, dragId: string) {
  const box = scrollEl.value?.querySelector(`[data-bucket=${bucket}]`);
  if (bucket === "today") {
    const rows = box
      ? [...box.querySelectorAll<HTMLElement>("[data-todo]")].filter((el) => el.dataset.todo !== dragId)
      : [];
    const midpoints = rows.map((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    const index = insertIndex(clientY, midpoints);
    return { bucket, group: null, index, beforeId: rows[index]?.dataset.todo ?? null };
  }
  const groups = box ? [...box.querySelectorAll<HTMLElement>("[data-group]")] : [];
  const hit = groups.find((el) => {
    const rect = el.getBoundingClientRect();
    return clientY >= rect.top && clientY < rect.bottom;
  });
  if (!hit) {
    const dragged = props.todos.find((t) => t.id === dragId);
    return {
      bucket,
      group: dragged?.projectId ?? null,
      index: Number.MAX_SAFE_INTEGER,
      beforeId: null,
    };
  }
  const group = hit.dataset.group || null;
  const rows = [...hit.querySelectorAll<HTMLElement>("[data-todo]")].filter(
    (el) => el.dataset.todo !== dragId,
  );
  const midpoints = rows.map((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const index = insertIndex(clientY, midpoints);
  return { bucket, group, index, beforeId: rows[index]?.dataset.todo ?? null };
}
```

`onDrop` 替换为：

```ts
function onDrop(id: string, clientY: number) {
  const row = props.todos.find((t) => t.id === id);
  const bucket = pickDragBucket(clientY, measureZones());
  const target = bucket ? measureInsert(bucket, clientY, id) : null;
  liftId.value = null;
  ghost.value = null;
  insert.value = null;
  if (!row || !bucket || !target) return;
  const from = todoWhen(row);
  if (bucket === "today") {
    if (from === "today") {
      const origin = buckets.value.today.findIndex((t) => t.id === id);
      if (origin < 0 || target.index === origin) return;
    }
    emit("move", id, "today", target.index);
    return;
  }
  // 以后：同组同位置则不动
  if (from === "later" && (row.projectId ?? null) === target.group) {
    const lane = later.value.filter((t) => (t.projectId ?? null) === target.group);
    const origin = lane.findIndex((t) => t.id === id);
    if (origin < 0 || target.index === origin) return;
  }
  emit("move", id, "later", target.index, target.group);
}
```

emit 类型定义改为：

```ts
const emit = defineEmits<{
  toggle: [id: string];
  remove: [id: string];
  move: [id: string, when: PlanBucket, index: number, projectId?: string | null];
}>();
```

- [ ] **Step 4: App 接线**

`src/App.vue` 的 `onMove` 替换为：

```ts
async function onMove(id: string, when: "today" | "later", index: number, projectId?: string | null) {
  await ready;
  await todoRepo.move(id, when, index, { projectId });
  todos.value = await todoRepo.list();
}
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run src/__tests__/todos-screen.test.ts && npm run test`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/screens/TodoScreen.vue src/App.vue src/__tests__/todos-screen.test.ts
git commit -m "feat: 待办拖拽认组（组内排序/跨组改归属/落空回自己组）"
```

---

### Task 7: 组标题把手拖拽排序

**Files:**
- Modify: `src/screens/TodoScreen.vue`
- Modify: `src/App.vue`（`onMoveGroup`）
- Modify: `src/styles.css`
- Test: `src/__tests__/todos-screen.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `projectRepo.move`、Task 1 的 `sortProjects`
- Produces: TodoScreen emit `moveGroup: [id: string, index: number]`（index 针对不含自身的非 done 组序列）

- [ ] **Step 1: 写失败测试**

`src/__tests__/todos-screen.test.ts` 末尾追加：

```ts
describe("TodoScreen 组排序", () => {
  const trioTodos: Todo[] = ["a1", "b1", "c1"].map((id, i) => ({
    id,
    title: id,
    status: "open" as const,
    sourceDate: "2026-09-06",
    createdAt: `2026-09-06T0${i + 1}:00:00.000Z`,
    when: "later" as const,
    projectId: `p${i + 1}`,
  }));
  const trioProjects: Project[] = ["p1", "p2", "p3"].map((id, i) => ({
    id,
    title: `组${id}`,
    status: "active" as const,
    createdAt: `2026-09-06T0${i + 1}:00:00.000Z`,
    updatedAt: `2026-09-06T0${i + 1}:00:00.000Z`,
  }));

  it("长按组把手拖到另一组下方：emit moveGroup", async () => {
    localStorage.clear();
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos: trioTodos, projects: trioProjects } });
    await flushPromises();
    mockRect(w.get("[data-group=p1]").element as HTMLElement, 0, 100);
    mockRect(w.get("[data-group=p2]").element as HTMLElement, 100, 200);
    mockRect(w.get("[data-group=p3]").element as HTMLElement, 200, 300);

    const handle = w.get("[data-group=p1] [data-group-handle]");
    await handle.trigger("pointerdown", { clientX: 10, clientY: 20, pointerId: 7 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    // p2 中点（150）之下、p3 中点（250）之上 → 不含自身的序列里第 1 位
    await handle.trigger("pointermove", { clientX: 10, clientY: 180, pointerId: 7 });
    await handle.trigger("pointerup", { clientX: 10, clientY: 180, pointerId: 7 });
    expect(w.emitted("moveGroup")?.[0]).toEqual(["p1", 1]);
  });

  it("已完成的组没有把手", async () => {
    localStorage.clear();
    const doneProjects = trioProjects.map((p) => (p.id === "p3" ? { ...p, status: "done" as const } : p));
    const w = mount(TodoScreen, { props: { todos: trioTodos, projects: doneProjects } });
    await flushPromises();
    expect(w.find("[data-group=p3] [data-group-handle]").exists()).toBe(false);
    expect(w.find("[data-group=p1] [data-group-handle]").exists()).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/todos-screen.test.ts`
Expected: FAIL（`[data-group-handle]` 不存在）

- [ ] **Step 3: 实现把手与拖拽**

模板 `.group-head` 内最前面加把手（`···` 菜单按钮在 Task 9 加）：

```html
            <span
              v-if="section.project && section.project.status !== 'done'"
              class="group-handle"
              data-group-handle
              @pointerdown="onGroupHandleDown(section.project.id, $event)"
              @click.stop
            >⠿</span>
```

`.group-head` 的 class 绑定加插入线：

```html
            :class="{
              done: section.project?.status === 'done',
              'drop-before': groupInsertBefore !== null && groupInsertBefore === (section.project?.id ?? ''),
            }"
```

脚本新增（放在 `onGroupClick` 后面）：

```ts
const groupInsertBefore = ref<string | null>(null);
let groupDragId: string | null = null;
let groupTimer: ReturnType<typeof setTimeout> | null = null;
let groupStartX = 0;
let groupStartY = 0;
let groupPointer: number | null = null;

// 「进行中组之后第一个分区」的 key：落空时插入线画在它上方；没有就靠桶尾。
const groupEndKey = computed(() => {
  const secs = laterSections.value;
  const hit = secs.find((s) => s.project === null || s.project.status === "done");
  return hit ? sectionKey(hit) : null;
});

function measureGroupInsert(clientY: number, dragId: string): { index: number; beforeKey: string } {
  const movable = [...(scrollEl.value?.querySelectorAll<HTMLElement>("[data-group]") ?? [])].filter(
    (el) => el.dataset.group && el.dataset.group !== dragId && el.dataset.done !== "1",
  );
  const midpoints = movable.map((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const index = insertIndex(clientY, midpoints);
  const beforeKey = movable[index]?.dataset.group ?? (groupEndKey.value ?? "__end__");
  return { index, beforeKey };
}

function clearGroupDrag() {
  if (groupTimer !== null) {
    clearTimeout(groupTimer);
    groupTimer = null;
  }
  groupPointer = null;
  groupDragId = null;
  groupInsertBefore.value = null;
  window.removeEventListener("pointermove", onGroupPointerMove, true);
  window.removeEventListener("pointerup", onGroupPointerUp, true);
  window.removeEventListener("pointercancel", onGroupPointerUp, true);
}

function onGroupHandleDown(id: string, e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  groupStartX = e.clientX;
  groupStartY = e.clientY;
  groupPointer = e.pointerId;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  groupTimer = setTimeout(() => {
    groupTimer = null;
    if (groupPointer === null) return;
    groupDragId = id;
    openId.value = null;
    try {
      navigator.vibrate?.(10);
    } catch {
      /* ignore */
    }
  }, HOLD_MS);
  window.addEventListener("pointermove", onGroupPointerMove, true);
  window.addEventListener("pointerup", onGroupPointerUp, true);
  window.addEventListener("pointercancel", onGroupPointerUp, true);
}

function onGroupPointerMove(e: PointerEvent) {
  if (groupPointer === null || e.pointerId !== groupPointer) return;
  if (!groupDragId) {
    // 拖动超过阈值 = 放弃长按，让位滚动
    if (Math.abs(e.clientX - groupStartX) >= 8 || Math.abs(e.clientY - groupStartY) >= 8) {
      clearGroupDrag();
    }
    return;
  }
  e.preventDefault();
  const { beforeKey } = measureGroupInsert(e.clientY, groupDragId);
  groupInsertBefore.value = beforeKey;
}

function onGroupPointerUp(e: PointerEvent) {
  if (groupPointer === null || e.pointerId !== groupPointer) return;
  const dragId = groupDragId;
  if (dragId) {
    const { index, beforeKey } = measureGroupInsert(e.clientY, dragId);
    // 原位置不动：落点正好是自己原来的位置
    const lane = sortProjects(props.projects ?? []).filter((p) => p.status !== "done");
    const origin = lane.findIndex((p) => p.id === dragId);
    if (!(beforeKey === "__end__" ? index === lane.length - 1 && origin === lane.length - 1 : index === origin)) {
      emit("moveGroup", dragId, index);
    }
  }
  clearGroupDrag();
}
```

`onUnmounted`（没有就新建）里调 `clearGroupDrag()`。imports 加 `sortProjects`（从 `@/todo-groups`）和 `onUnmounted`（从 `vue`）。emit 类型加：

```ts
  moveGroup: [id: string, index: number];
```

注意：上面 `__end__` 是内部哨兵值（表示插到进行中组末尾），模板插入线判断用：

```ts
function isGroupDropBefore(s: LaterSection): boolean {
  const before = groupInsertBefore.value;
  if (before === null) return false;
  if (before === "__end__") return groupEndKey.value === null && sectionKey(s) === lastActiveKey();
  return before === sectionKey(s) || (before !== "" && groupInsertBefore.value === sectionKey(s));
}
```

为简单起见，实现时把模板里的判断收敛成一个函数 `isGroupDropBefore(section)`：

```ts
function isGroupDropBefore(s: LaterSection): boolean {
  const before = groupInsertBefore.value;
  if (before === null) return false;
  if (before === "__end__") return groupEndKey.value === null && isLastActive(s);
  return before === sectionKey(s);
}

function isLastActive(s: LaterSection): boolean {
  const actives = laterSections.value.filter((x) => x.project && x.project.status !== "done");
  return actives.at(-1)?.project?.id === s.project?.id;
}
```

模板 `.group-head` 的 class 绑定最终写成：

```html
            :class="{ done: section.project?.status === 'done', 'drop-before': isGroupDropBefore(section) }"
```

样式追加（`src/styles.css` `.group-arrow` 后）：

```css
.group-handle {
  color: var(--mute);
  font-size: 12px;
  cursor: grab;
  touch-action: none;
  padding: 0 2px;
  align-self: center;
}
.group-head.drop-before {
  box-shadow: 0 -3px 0 0 var(--dawn);
}
```

- [ ] **Step 4: App 接线**

`src/App.vue` 模板里 `TodoScreen` 加 `@move-group="onMoveGroup"`，脚本加：

```ts
async function onMoveGroup(id: string, index: number) {
  await ready;
  await projectRepo.move(id, index);
  await refreshState();
}
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run src/__tests__/todos-screen.test.ts && npm run test`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/screens/TodoScreen.vue src/App.vue src/styles.css src/__tests__/todos-screen.test.ts
git commit -m "feat: 组标题把手拖拽排序"
```

---

### Task 8: 确认框按组分组展示

**Files:**
- Modify: `src/components/TodoConfirm.vue`
- Modify: `src/screens/ChatScreen.vue`（透传新 prop）
- Modify: `src/App.vue`（传 `existingProjects`）
- Modify: `src/styles.css`
- Test: `src/__tests__/todo-confirm.test.ts`（新建）

**Interfaces:**
- Consumes: `normKey`（`@/norm`）
- Produces: TodoConfirm 新 prop `existingProjects?: string[]`（已有项目标题，用来给新组打「新」标）；ChatScreen 同名透传 prop。

- [ ] **Step 1: 写失败测试**

新建 `src/__tests__/todo-confirm.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TodoConfirm from "@/components/TodoConfirm.vue";
import type { ProposedTodo } from "@/types";

const items: ProposedTodo[] = [
  { title: "找房", when: "later", project: "搬家" },
  { title: "打包", when: "later", project: "搬家" },
  { title: "买纸箱", when: "later" },
  { title: "写稿子", when: "later", project: "发布会" },
];

describe("TodoConfirm 按组分组", () => {
  it("同组候选收在组名标题下，未分组无组标题", () => {
    const w = mount(TodoConfirm, { props: { items, existingProjects: [] } });
    const labels = w.findAll(".propose-sub").map((el) => el.text());
    expect(labels.some((t) => t.includes("搬家"))).toBe(true);
    expect(labels.some((t) => t.includes("发布会"))).toBe(true);
    expect(labels).toHaveLength(2);
    // 组标题相对位置：搬家标题在「找房」前
    const text = w.text();
    expect(text.indexOf("搬家")).toBeLessThan(text.indexOf("找房"));
    expect(text.indexOf("买纸箱")).toBeGreaterThan(text.indexOf("写稿子"));
  });

  it("已有项目不打标，新组标「新」", () => {
    const w = mount(TodoConfirm, { props: { items, existingProjects: ["搬家"] } });
    const subs = w.findAll(".propose-sub");
    const move = subs.find((el) => el.text().includes("搬家"))!;
    const launch = subs.find((el) => el.text().includes("发布会"))!;
    expect(move.find(".propose-new").exists()).toBe(false);
    expect(launch.find(".propose-new").exists()).toBe(true);
  });

  it("全部无组时不渲染组标题；confirm 仍按勾选原样抛出", async () => {
    const plain: ProposedTodo[] = [{ title: "甲" }, { title: "乙" }];
    const w = mount(TodoConfirm, { props: { items: plain } });
    expect(w.find(".propose-sub").exists()).toBe(false);
    await w.findAll(".todo-pick input")[1].setValue(false);
    await w.get(".btn-yes").trigger("click");
    expect(w.emitted("confirm")?.[0]).toEqual([[{ title: "甲" }]]);
  });

  it("today/later 分桶标签保留", () => {
    const mixed: ProposedTodo[] = [
      { title: "今天事", when: "today", project: "搬家" },
      { title: "以后事", when: "later", project: "搬家" },
    ];
    const w = mount(TodoConfirm, { props: { items: mixed } });
    const groups = w.findAll(".propose-group").map((el) => el.text());
    expect(groups).toContain("今天");
    expect(groups).toContain("以后");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/todo-confirm.test.ts`
Expected: FAIL（`.propose-sub` 不存在）

- [ ] **Step 3: 改 TodoConfirm**

模板里 `<template v-if="showGroups">…</template><template v-else>…</template>` 两段整体替换为：

```html
        <template v-for="(s, si) in sections" :key="si">
          <p
            v-if="showWhen && (si === 0 || sections[si - 1].when !== s.when)"
            class="propose-group"
          >{{ s.when === "today" ? "今天" : "以后" }}</p>
          <p v-if="s.project" class="propose-sub">
            {{ s.project }}<span v-if="s.isNew" class="propose-new">新</span>
          </p>
          <label v-for="i in s.idxs" :key="`${s.when}-${s.project ?? ""}-${i}`" class="todo-pick">
            <input v-model="checked[i]" type="checkbox" />
            <span>{{ items[i].title }}</span>
            <span v-if="metaFor(items[i])" class="todo-meta">{{ metaFor(items[i]) }}</span>
          </label>
        </template>
```

脚本：props 加 `existingProjects?: string[]`（withDefaults 默认 `() => []`）；删掉 `todayIdxs` / `laterIdxs` / `showGroups`，换成：

```ts
import { normKey } from "@/norm";

interface ConfirmSection {
  when: "today" | "later";
  project: string | null;
  isNew: boolean;
  idxs: number[];
}

const sections = computed<ConfirmSection[]>(() => {
  const existing = new Set((props.existingProjects ?? []).map((t) => normKey(t)));
  const out: ConfirmSection[] = [];
  for (const when of ["today", "later"] as const) {
    const byProject = new Map<string | null, number[]>();
    props.items.forEach((it, i) => {
      if ((it.when === "later" ? "later" : "today") !== when) return;
      const key = it.project?.trim() ? it.project.trim() : null;
      const arr = byProject.get(key) ?? [];
      arr.push(i);
      byProject.set(key, arr);
    });
    const keys = [...byProject.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));
    for (const key of keys) {
      out.push({ when, project: key, isNew: !!key && !existing.has(normKey(key)), idxs: byProject.get(key)! });
    }
  }
  return out;
});

const showWhen = computed(
  () => props.items.some((it) => it.when === "later") && props.items.some((it) => it.when !== "later"),
);
```

注意：`metaFor` 里项目名已经不显示了也没关系——保持现状（组标题承担了分组语义，徽标里重复显示无妨，不改 `todoMeta`）。

样式追加（`src/styles.css` `.propose-group` 规则后）：

```css
.propose-sub {
  font-size: 12px;
  font-weight: 600;
  color: var(--paper);
  margin: 6px 0 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.propose-new {
  font-size: 10px;
  color: var(--dawn);
  border: 1px solid var(--dawn);
  border-radius: 6px;
  padding: 0 4px;
}
```

- [ ] **Step 4: 穿透 existingProjects**

`src/screens/ChatScreen.vue`：props 加 `existingProjects?: string[]`；两个 `TodoConfirm` 都加 `:existing-projects="existingProjects"`。

`src/App.vue`：`ChatScreen` 加 `:existing-projects="projects.map((p) => p.title)"`。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run src/__tests__/todo-confirm.test.ts && npm run test`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/TodoConfirm.vue src/screens/ChatScreen.vue src/App.vue src/styles.css src/__tests__/todo-confirm.test.ts
git commit -m "feat: 待确认框按项目组分组展示，新组打标"
```

---

### Task 9: 手动操作（任务改组 + 组管理浮层 GroupSheet）

**Files:**
- Create: `src/components/GroupSheet.vue`
- Modify: `src/components/TodoRow.vue`（revealed 区加「分组」按钮）
- Modify: `src/screens/TodoScreen.vue`（集成浮层、组头 `···` 按钮）
- Modify: `src/App.vue`（`onAssignGroup` / `onRenameGroup` / `onCompleteGroup`）
- Modify: `src/styles.css`
- Test: `src/__tests__/group-sheet.test.ts`（新建）、`src/__tests__/todos-screen.test.ts`（追加集成用例）

**Interfaces:**
- Consumes: Task 3 的 `todoRepo.setProject` / `projectRepo.put` / `projectRepo.upsertByTitle`
- Produces:
  - TodoRow 新 emit `group: [id: string]`
  - TodoScreen 新 emit：`assign: [todoId: string, projectId: string | null, newTitle?: string]`、`renameGroup: [id: string, title: string]`、`completeGroup: [id: string, done: boolean]`
  - GroupSheet props：`{ mode: "assign" | "manage"; projects: Project[]; current?: string | null; group?: Project | null; openCount?: number }`；emits：`pick: [projectId: string | null, newTitle?: string]`、`rename: [title: string]`、`complete: [done: boolean]`、`close: []`

- [ ] **Step 1: 写失败测试**

新建 `src/__tests__/group-sheet.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GroupSheet from "@/components/GroupSheet.vue";
import type { Project } from "@/types";

const projects: Project[] = [
  { id: "p1", title: "搬家", status: "active", createdAt: "2026-09-06T01:00:00.000Z", updatedAt: "2026-09-06T01:00:00.000Z" },
  { id: "p2", title: "发布会", status: "done", createdAt: "2026-09-05T01:00:00.000Z", updatedAt: "2026-09-05T01:00:00.000Z" },
];

describe("GroupSheet assign 模式", () => {
  it("列出进行中组与未分组，点组抛出 pick", async () => {
    const w = mount(GroupSheet, { props: { mode: "assign", projects, current: null } });
    expect(w.text()).toContain("搬家");
    expect(w.text()).not.toContain("发布会");
    await w.get("[data-pick=p1]").trigger("click");
    expect(w.emitted("pick")?.[0]).toEqual(["p1", undefined]);
    await w.get("[data-pick=none]").trigger("click");
    expect(w.emitted("pick")?.[1]).toEqual([null, undefined]);
  });

  it("新建组：输入为空禁用，确认抛出新标题", async () => {
    const w = mount(GroupSheet, { props: { mode: "assign", projects, current: "p1" } });
    const btn = w.get("[data-new-confirm]");
    expect(btn.attributes("disabled")).toBeDefined();
    await w.get("input").setValue("装修");
    await btn.trigger("click");
    expect(w.emitted("pick")?.[0]).toEqual([null, "装修"]);
  });
});

describe("GroupSheet manage 模式", () => {
  it("有未完任务时不出完成按钮；能完成时抛出 complete", async () => {
    const busy = mount(GroupSheet, {
      props: { mode: "manage", projects, group: projects[0], openCount: 2 },
    });
    expect(busy.find("[data-complete]").exists()).toBe(false);
    expect(busy.text()).toContain("还有 2 件没做完");

    const idle = mount(GroupSheet, {
      props: { mode: "manage", projects, group: projects[0], openCount: 0 },
    });
    await idle.get("[data-complete]").trigger("click");
    expect(idle.emitted("complete")?.[0]).toEqual([true]);
  });

  it("done 组显示重新打开；重命名抛出标题", async () => {
    const w = mount(GroupSheet, {
      props: { mode: "manage", projects, group: projects[1], openCount: 0 },
    });
    await w.get("[data-reopen]").trigger("click");
    expect(w.emitted("complete")?.[0]).toEqual([false]);

    const ren = mount(GroupSheet, {
      props: { mode: "manage", projects, group: projects[0], openCount: 0 },
    });
    await ren.get("input").setValue("乔迁");
    await ren.get("[data-rename]").trigger("click");
    expect(ren.emitted("rename")?.[0]).toEqual(["乔迁"]);
  });
});
```

`src/__tests__/todos-screen.test.ts` 末尾追加集成用例：

```ts
describe("TodoScreen 手动改组", () => {
  it("revealed 区点「分组」打开浮层，选组后 emit assign", async () => {
    localStorage.clear();
    const todos: Todo[] = [
      { id: "u1", title: "零散事", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", when: "later" },
    ];
    const projects: Project[] = [
      { id: "p1", title: "搬家", status: "active", createdAt: "2026-09-06T01:00:00.000Z", updatedAt: "2026-09-06T01:00:00.000Z" },
    ];
    const w = mount(TodoScreen, { props: { todos, projects } });
    await flushPromises();
    const row = w.get("[data-todo=u1]");
    await row.get(".item").trigger("pointerdown", { clientX: 200, clientY: 20, pointerId: 1 });
    await row.get(".item").trigger("pointermove", { clientX: 110, clientY: 20, pointerId: 1 });
    await row.get(".item").trigger("pointerup", { clientX: 110, clientY: 20, pointerId: 1 });
    await row.get("[data-todo-group]").trigger("click");
    await w.get("[data-pick=p1]").trigger("click");
    expect(w.emitted("assign")?.[0]).toEqual(["u1", "p1", undefined]);
  });

  it("组头 ··· 打开管理浮层", async () => {
    localStorage.clear();
    const todos: Todo[] = [
      { id: "a1", title: "a1", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", when: "later", projectId: "p1" },
    ];
    const projects: Project[] = [
      { id: "p1", title: "搬家", status: "active", createdAt: "2026-09-06T01:00:00.000Z", updatedAt: "2026-09-06T01:00:00.000Z" },
    ];
    const w = mount(TodoScreen, { props: { todos, projects } });
    await flushPromises();
    await w.get("[data-group=p1] [data-group-menu]").trigger("click");
    expect(w.find(".sheet").exists()).toBe(true);
    expect(w.text()).toContain("还有 1 件没做完");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/group-sheet.test.ts`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现 GroupSheet.vue**

```vue
<template>
  <div class="sheet-mask" @click.self="emit('close')">
    <div class="sheet">
      <header>{{ mode === "assign" ? "归到哪个组？" : (group?.title ?? "") }}</header>
      <template v-if="mode === 'assign'">
        <button
          v-for="p in openProjects"
          :key="p.id"
          class="sheet-opt"
          type="button"
          :data-pick="p.id"
          @click="emit('pick', p.id)"
        >
          {{ p.title }}<span v-if="p.id === current" class="sheet-cur">当前</span>
        </button>
        <button class="sheet-opt" type="button" data-pick="none" @click="emit('pick', null)">未分组</button>
        <div class="sheet-row">
          <input v-model="newTitle" type="text" placeholder="新建组…" @keydown.enter="onNew" />
          <button type="button" data-new-confirm :disabled="!newTitle.trim()" @click="onNew">建好</button>
        </div>
      </template>
      <template v-else>
        <div class="sheet-row">
          <input v-model="renameTitle" type="text" :placeholder="group?.title ?? '组名'" @keydown.enter="onRename" />
          <button type="button" data-rename :disabled="!renameTitle.trim()" @click="onRename">重命名</button>
        </div>
        <p v-if="(openCount ?? 0) > 0" class="sheet-note">还有 {{ openCount }} 件没做完</p>
        <button v-else-if="group?.status !== 'done'" class="sheet-opt" type="button" data-complete @click="emit('complete', true)">
          完成项目
        </button>
        <button v-if="group?.status === 'done'" class="sheet-opt" type="button" data-reopen @click="emit('complete', false)">
          重新打开
        </button>
      </template>
      <button class="sheet-close" type="button" @click="emit('close')">取消</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { Project } from "@/types";

const props = defineProps<{
  mode: "assign" | "manage";
  projects: Project[];
  current?: string | null;
  group?: Project | null;
  openCount?: number;
}>();
const emit = defineEmits<{
  pick: [projectId: string | null, newTitle?: string];
  rename: [title: string];
  complete: [done: boolean];
  close: [];
}>();

const openProjects = computed(() => props.projects.filter((p) => p.status !== "done"));
const newTitle = ref("");
const renameTitle = ref("");

function onNew() {
  const t = newTitle.value.trim();
  if (!t) return;
  emit("pick", null, t);
}

function onRename() {
  const t = renameTitle.value.trim();
  if (!t) return;
  emit("rename", t);
}
</script>
```

- [ ] **Step 4: TodoRow 加「分组」按钮**

模板 `.todo-swipe` 内 `.todo-del` 之前加：

```html
    <button class="todo-act" type="button" data-todo-group @click.stop="emit('group', todo.id)">分组</button>
```

emit 类型加 `group: [id: string]`。常量改动：

```ts
const BTN_W = 76;
const OPEN_X = -BTN_W * 2;
```

（删掉原 `DELETE_W`；`OPEN_X` 用它。）

样式（`src/styles.css` `.todo-del` 规则后）：

```css
.todo-act {
  position: absolute;
  right: 76px;
  top: 0;
  bottom: 0;
  width: 76px;
  border: 0;
  background: var(--panel);
  color: var(--paper);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  letter-spacing: 0.08em;
}
.todo-act:active { filter: brightness(1.2); }
```

- [ ] **Step 5: TodoScreen 集成浮层与组头菜单按钮**

模板：

1) `.group-head` 里 `.group-arrow` 之前加：

```html
            <button
              v-if="section.project"
              class="group-menu"
              data-group-menu
              type="button"
              @click.stop="onGroupMenu(section)"
            >···</button>
```

2) 根 `</section>` 前加：

```html
    <GroupSheet
      v-if="sheet"
      :mode="sheet.mode"
      :projects="projects ?? []"
      :current="sheet.mode === 'assign' ? (todos.find((t) => t.id === sheet.todoId)?.projectId ?? null) : undefined"
      :group="sheet.mode === 'manage' ? sheet.project : undefined"
      :open-count="sheet.mode === 'manage' ? openCountOf(sheet.project.id) : undefined"
      @pick="onSheetPick"
      @rename="onSheetRename"
      @complete="onSheetComplete"
      @close="sheet = null"
    />
```

脚本：

```ts
import GroupSheet from "@/components/GroupSheet.vue";

const sheet = ref<{ mode: "assign"; todoId: string } | { mode: "manage"; project: Project } | null>(null);

function openCountOf(pid: string): number {
  return props.todos.filter((t) => t.projectId === pid && t.status === "open").length;
}

function onGroupMenu(s: LaterSection) {
  if (s.project) sheet.value = { mode: "manage", project: s.project };
}

function onRowGroup(id: string) {
  openId.value = null;
  sheet.value = { mode: "assign", todoId: id };
}

function onSheetPick(projectId: string | null, newTitle?: string) {
  const s = sheet.value;
  sheet.value = null;
  if (s?.mode === "assign") emit("assign", s.todoId, projectId, newTitle);
}

function onSheetRename(title: string) {
  const s = sheet.value;
  sheet.value = null;
  if (s?.mode === "manage") emit("renameGroup", s.project.id, title);
}

function onSheetComplete(done: boolean) {
  const s = sheet.value;
  sheet.value = null;
  if (s?.mode === "manage") emit("completeGroup", s.project.id, done);
}
```

emit 类型加：

```ts
  assign: [todoId: string, projectId: string | null, newTitle?: string];
  renameGroup: [id: string, title: string];
  completeGroup: [id: string, done: boolean];
```

所有 `TodoRow`（今天、以后、已完成三处）加 `@group="onRowGroup"`。

样式追加：

```css
.group-menu {
  border: 0;
  background: none;
  color: var(--mute);
  font-size: 13px;
  cursor: pointer;
  padding: 0 2px;
  letter-spacing: 0.1em;
}
.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: var(--bg);
  border-radius: 18px 18px 0 0;
  padding: 16px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sheet header {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.sheet-opt {
  text-align: left;
  padding: 12px;
  border: 0;
  border-radius: 12px;
  background: var(--panel);
  color: var(--paper);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
}
.sheet-cur { color: var(--dawn); font-size: 11px; }
.sheet-row { display: flex; gap: 8px; }
.sheet-row input {
  flex: 1;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: var(--panel);
  color: var(--paper);
  font: inherit;
}
.sheet-row button {
  border: 0;
  border-radius: 12px;
  padding: 0 14px;
  background: var(--dawn);
  color: #1a1408;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.sheet-row button:disabled { opacity: 0.4; }
.sheet-note { font-size: 12px; color: var(--mute); }
.sheet-close {
  border: 0;
  background: none;
  color: var(--mute);
  font: inherit;
  font-size: 13px;
  padding: 8px;
  cursor: pointer;
}
```

- [ ] **Step 6: App 接线**

`src/App.vue` 模板 `TodoScreen` 加：

```html
        @assign="onAssignGroup"
        @rename-group="onRenameGroup"
        @complete-group="onCompleteGroup"
```

脚本加：

```ts
async function onAssignGroup(id: string, projectId: string | null, newTitle?: string) {
  await ready;
  let pid = projectId;
  if (newTitle) {
    const p = await projectRepo.upsertByTitle(newTitle, {});
    pid = p.id;
  }
  await todoRepo.setProject(id, pid);
  todos.value = await todoRepo.list();
}

async function onRenameGroup(id: string, title: string) {
  await ready;
  const p = projects.value.find((x) => x.id === id);
  if (!p) return;
  await projectRepo.put({ ...p, title, updatedAt: new Date().toISOString() });
  await refreshState();
}

async function onCompleteGroup(id: string, done: boolean) {
  await ready;
  const p = projects.value.find((x) => x.id === id);
  if (!p) return;
  await projectRepo.put({ ...p, status: done ? "done" : "active", updatedAt: new Date().toISOString() });
  await refreshState();
}
```

- [ ] **Step 7: 跑测试**

Run: `npx vitest run src/__tests__/group-sheet.test.ts src/__tests__/todos-screen.test.ts src/__tests__/todo-row.test.ts && npm run test`
Expected: 全部 PASS（`todo-row.test.ts` 现有用例不依赖 OPEN_X 具体值，应不受影响；若有断言滑动距离失败的，把测试里的位移放大到超过 76px 即可）

- [ ] **Step 8: Commit**

```bash
git add src/components/GroupSheet.vue src/components/TodoRow.vue src/screens/TodoScreen.vue src/App.vue src/styles.css src/__tests__/group-sheet.test.ts src/__tests__/todos-screen.test.ts
git commit -m "feat: 手动改组与组管理浮层"
```

---

### Task 10: 组状态自动同步接线 + 文档 + 全量验证

**Files:**
- Modify: `src/App.vue`
- Modify: `AGENTS.md`
- Test: `src/__tests__/app-project-sync.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `syncProjectStatuses`、Task 3 的 `projectRepo.put`
- Produces: App 内部 `syncProjects(): Promise<void>`，在 `onToggle` / `onRemove` / `onMove` / `addTodos` / `onAssignGroup` 末尾调用。

- [ ] **Step 1: 写失败测试**

新建 `src/__tests__/app-project-sync.test.ts`（mock 模式照抄 `close-session-app.test.ts`）：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { localDate } from "@/dates";
import { chatRepo, deleteDb, projectRepo, todoRepo } from "@/storage/db";
import App from "@/App.vue";

vi.mock("@/api/deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/deepseek")>();
  return { ...actual, chatCompletions: vi.fn() };
});

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 50; i++) {
    await flushPromises();
    if (check()) return;
  }
  throw new Error("timed out");
}

describe("组状态随勾选自动流转", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    // 垫一条消息，避免主动开场抢 awaiting
    await chatRepo.append(localDate(), {
      id: "m1",
      role: "user",
      content: "今天有点忙",
      createdAt: "2026-09-06T01:00:00.000Z",
      mode: "chat",
    });
    const p = await projectRepo.upsertByTitle("搬家", {});
    await todoRepo.add({
      id: "t1", title: "找房", status: "open", sourceDate: localDate(),
      createdAt: "2026-09-06T01:00:00.000Z", when: "later", projectId: p.id,
    });
    await todoRepo.add({
      id: "t2", title: "打包", status: "open", sourceDate: localDate(),
      createdAt: "2026-09-06T02:00:00.000Z", when: "later", projectId: p.id,
    });
  });

  it("勾掉组内最后一条 → 组自动 done；取消勾 → 组自动回 active", async () => {
    const w = mount(App);
    await waitFor(() => w.text().includes("今天有点忙"));
    await w.get("[data-nav=todo]").trigger("click");
    await waitFor(() => w.text().includes("找房"));

    await w.get("[data-todo=t1] .item").trigger("click");
    await waitFor(() => w.find("[data-todo=t1] .item").classes().includes("done"));
    let p = (await projectRepo.list()).find((x) => x.title === "搬家")!;
    expect(p.status).toBe("active");

    await w.get("[data-todo=t2] .item").trigger("click");
    await waitFor(async () => {
      await flushPromises();
      return (await projectRepo.list()).find((x) => x.title === "搬家")?.status === "done";
    });
    p = (await projectRepo.list()).find((x) => x.title === "搬家")!;
    expect(p.status).toBe("done");

    await w.get("[data-todo=t2] .item").trigger("click");
    await waitFor(async () => {
      await flushPromises();
      return (await projectRepo.list()).find((x) => x.title === "搬家")?.status === "active";
    });
  });
});
```

注意：勾掉的任务落在「已完成」区，`data-todo` 选择器仍有效；取消勾点的是同一行。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/app-project-sync.test.ts`
Expected: FAIL（组状态不会自动变）

- [ ] **Step 3: App 加 syncProjects 并接线**

`src/App.vue` import 加 `import { syncProjectStatuses } from "@/todo-groups";`，脚本加：

```ts
// 组状态随任务自动流转：最后一条勾掉 → done；来了新活 → active。
async function syncProjects() {
  const all = await todoRepo.list();
  const nowIso = new Date().toISOString();
  const next = syncProjectStatuses(projects.value, all, nowIso);
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== projects.value[i]) await projectRepo.put(next[i]);
  }
  await refreshState();
}
```

接线（各函数末尾、`todos.value = await todoRepo.list()` 之后）：

- `onToggle`：加 `await syncProjects();`
- `onRemove`：加 `await syncProjects();`
- `onMove`：加 `await syncProjects();`
- `addTodos`：末尾加 `await syncProjects();`
- `onAssignGroup`：末尾加 `await syncProjects();`

- [ ] **Step 4: 跑测试**

Run: `npm run test`
Expected: 全部 PASS

- [ ] **Step 5: 更新 AGENTS.md**

`AGENTS.md` 两处：

1) 「关键架构规则」待办两桶那条末尾追加一句：

```markdown
  「以后」栏按项目分区展示（组 = 复用 `Project`，非真层级）：分区/进度/自动完成/组排序的纯函数在 `src/todo-groups.ts`（`partitionLater` / `syncProjectStatuses` / `applyProjectMove`），`applyMove` 的落点支持带 `projectId`（跨组拖拽即改归属）；组内最后一条勾掉组自动 done、来新任务自动回 active（`App.vue` 的 `syncProjects` 在所有任务变更点调用）。
```

2) 「代码组织」`其余顶层模块` 一行里加 `todo-groups（以后栏分区）`，`components/` 一行里加 `GroupSheet`。

- [ ] **Step 6: 全量验证**

Run: `npm run test && npm run build`
Expected: 测试全过；vue-tsc + vite build 无错误。

- [ ] **Step 7: Commit**

```bash
git add src/App.vue AGENTS.md src/__tests__/app-project-sync.test.ts
git commit -m "feat: 组随任务自动完成/重激活；文档更新"
```

---

## Self-Review 记录

- **Spec 覆盖**：今天平铺（Task 5 不动今天桶）✓；以后分区+进度+折叠（Task 5）✓；自动完成/重激活（Task 1 纯函数 + Task 10 接线）✓；确认框分组+新组标（Task 8）✓；任务组内/跨组/今天拖下/落空回组（Task 2、6）✓；组排序（Task 1、3、7）✓；手动改组/新建组/重命名/手动完成（Task 9）✓；不改项（日记快照、set_today_plan 等）在 Global Constraints 声明 ✓。
- **类型一致性**：`LaterSection` / `partitionLater` / `syncProjectStatuses` / `applyProjectMove`（Task 1 定义，Task 3、5、7、10 消费）；`applyMove` 的 `to.projectId?: string | null`（Task 2 定义，Task 3 仓储、Task 6 UI 消费）；`move` emit 第 4 参（Task 6 定义，Task 6 App 消费）；`assign` / `renameGroup` / `completeGroup`（Task 9 定义并接线）✓。
