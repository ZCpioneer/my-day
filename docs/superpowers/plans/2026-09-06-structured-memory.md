# 结构化记忆架构实现计划（解析层 + Timeline/State/Memory + Context Builder）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把朝暮 Agent 从「整段聊天记录喂模型」改为「每条输入先独立解析成结构化信息，分 Timeline/State/Memory 三层落库，回复前按当前输入动态组装上下文」，待办与记忆写入保留用户确认。

**Architecture:** 每条非 silent 用户消息先过独立解析调用（`src/agent/parse.ts`，只输出 JSON），`route-parse.ts` 把产出路由到对应层：events/decisions/projects/waitings 自动落库，tasks/memories 弹确认框后落库。回复循环移除 `propose_todos`/`suggest_order`，上下文由 `context.ts` 注入三层摘要 + 截断历史。P2 再把上下文升级为按 ParseResult 动态组装。

**Tech Stack:** Vue 3 + TypeScript strict + Vite + vitest（fake-indexeddb）+ IndexedDB（DB v2）。

**Spec:** `docs/superpowers/specs/2026-09-06-structured-memory-design.md`

## Global Constraints

- 注释、提交信息、面向用户文案、模型提示词全部用中文。
- TypeScript strict；`@/` 别名指向 `src/`；不新增任何 npm 依赖。
- 存储只用 IndexedDB（单库 `zhaomu`，升级到 version 2）；日期用本地日历日 `localDate`，不用 UTC。
- Agent 永远不直接写待办/记忆：只能弹确认框，用户确认后落库。
- API 请求非流式，显式 `thinking: { type: "disabled" }`（`chatCompletions` 已统一带）。
- 业务规则写成不依赖框架的纯函数，副作用（仓储/网络/时间）通过参数注入。
- 测试全部在 `src/__tests__/`，命名与被测模块同名；不打真实网络（eval 除外，见 Task 12）。
- 每个 Task 完成后提交一次，提交信息用中文 conventional 格式（如 `feat: ...`）。
- 全部 Task 完成后 `npm run test` 与 `npm run build` 必须全绿。

---

### Task 1: 共享类型扩展 + normKey 工具

**Files:**
- Create: `src/norm.ts`
- Modify: `src/types.ts`
- Test: `src/__tests__/norm.test.ts`

**Interfaces:**
- Produces:
  - `normKey(s: string): string`（忽略空白与大小写的归一化，全项目统一入口）
  - types: `TimelineEvent` / `Project` / `Waiting` / `Memory` / `MemoryCandidate` / `ParsedTask` / `ProjectUpdate` / `ParsedWaiting` / `ParseResult` / `MEMORY_KIND_LABEL`
  - `Todo` 新增可选字段 `priority` / `due` / `projectId`；`ProposedTodo` 新增 `priority` / `due` / `project` / `tag`
  - `DebugEvent` 增加 `"parse_fail"`

- [ ] **Step 1: 写失败测试** `src/__tests__/norm.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { normKey } from "@/norm";

describe("normKey", () => {
  it("忽略空白与大小写", () => {
    expect(normKey(" 给房东 转水电费 ")).toBe("给房东转水电费");
    expect(normKey("Postgres DB")).toBe("postgresdb");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/norm.test.ts`
Expected: FAIL（`@/norm` 不存在）

- [ ] **Step 3: 实现 `src/norm.ts`**

```ts
export function normKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}
```

- [ ] **Step 4: 扩展 `src/types.ts`**

`Todo` 接口在 `order?: number;` 后追加：

```ts
  /** 缺失 = normal（兼容旧数据）。 */
  priority?: "high" | "normal";
  /** ISO 日期或日期时间，可选。 */
  due?: string;
  /** 关联项目 id，可选。 */
  projectId?: string;
```

`ProposedTodo` 改为：

```ts
export interface ProposedTodo {
  title: string;
  reason?: string;
  when?: "today" | "later";
  priority?: "high" | "normal";
  due?: string;
  /** 项目标题，落库时解析成 projectId。 */
  project?: string;
  /** 确认框上的展示标签（如记忆类别），不落库。 */
  tag?: string;
}
```

`DebugEvent` 联合类型末尾增加 `| "parse_fail"`。

文件末尾（`DEFAULT_MODEL` 之前）追加：

```ts
export interface TimelineEvent {
  id: string;
  /** 本地日历日。 */
  date: string;
  createdAt: string;
  kind: "event" | "decision";
  /** 一句事实。 */
  text: string;
  fromMessageId: string;
}

export interface Project {
  id: string;
  title: string;
  status: "active" | "done" | "paused";
  /** 最近进展。 */
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Waiting {
  id: string;
  /** 在等什么。 */
  text: string;
  /** 等谁/等什么条件。 */
  waitingOn?: string;
  since: string;
  /** 有值 = 已解决。 */
  resolvedAt?: string;
  fromMessageId: string;
}

export interface Memory {
  id: string;
  text: string;
  kind: "preference" | "goal" | "watch";
  createdAt: string;
}

export const MEMORY_KIND_LABEL: Record<Memory["kind"], string> = {
  preference: "偏好",
  goal: "目标",
  watch: "关注",
};

export interface ParsedTask {
  title: string;
  reason?: string;
  priority?: "high" | "normal";
  due?: string;
  /** 项目标题，优先从现有项目里选。 */
  project?: string;
}

export interface ProjectUpdate {
  project: string;
  note: string;
  status?: "active" | "done" | "paused";
}

export interface ParsedWaiting {
  text: string;
  waitingOn?: string;
}

export interface MemoryCandidate {
  text: string;
  kind: "preference" | "goal" | "watch";
}

/** 解析层对一条用户输入的结构化产出；六类全空 = 纯闲聊。 */
export interface ParseResult {
  events: string[];
  decisions: string[];
  tasks: ParsedTask[];
  projectUpdates: ProjectUpdate[];
  waitings: ParsedWaiting[];
  waitingsResolved: string[];
  memories: MemoryCandidate[];
}
```

- [ ] **Step 5: 跑测试 + 类型检查**

Run: `npx vitest run src/__tests__/norm.test.ts && npm run build`
Expected: PASS；build 通过（新类型不影响现有代码）

- [ ] **Step 6: Commit**

```bash
git add src/norm.ts src/types.ts src/__tests__/norm.test.ts
git commit -m "feat: 结构化记忆的共享类型与 normKey 工具"
```

---

### Task 2: IndexedDB 升级 v2 + 四个新仓储

**Files:**
- Modify: `src/storage/db.ts`
- Test: `src/__tests__/db.test.ts`（扩展）、`src/__tests__/db-migration.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的类型、`normKey`、`localDate`/`shiftLocalDate`（`@/dates`）、`newId`（`@/ids`）
- Produces:
  - `eventRepo.add(e: TimelineEvent): Promise<void>`、`eventRepo.listRecent(days: number, now?: Date): Promise<TimelineEvent[]>`（按 createdAt 升序）
  - `projectRepo.list(): Promise<Project[]>`、`projectRepo.upsertByTitle(title: string, patch: { note?: string; status?: Project["status"] }, now?: Date): Promise<Project>`
  - `waitingRepo.add(w: Waiting): Promise<void>`、`waitingRepo.listOpen(): Promise<Waiting[]>`、`waitingRepo.resolve(id: string, now?: Date): Promise<void>`
  - `memoryRepo.add(m: Memory): Promise<void>`、`memoryRepo.list(): Promise<Memory[]>`、`memoryRepo.remove(id: string): Promise<void>`

- [ ] **Step 1: 写失败测试（仓储 CRUD，追加到 `src/__tests__/db.test.ts`）**

```ts
  it("eventRepo.listRecent 只返回近 N 天且按时间升序", async () => {
    const now = new Date(2026, 8, 6, 12, 0, 0);
    await eventRepo.add({ id: "e1", date: "2026-09-03", createdAt: "2026-09-03T02:00:00.000Z", kind: "event", text: "更早的事", fromMessageId: "m1" });
    await eventRepo.add({ id: "e2", date: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", kind: "decision", text: "定了用 Postgres", fromMessageId: "m2" });
    await eventRepo.add({ id: "e3", date: "2026-09-05", createdAt: "2026-09-05T03:00:00.000Z", kind: "event", text: "昨天的事", fromMessageId: "m3" });
    const recent = await eventRepo.listRecent(3, now);
    expect(recent.map((e) => e.id)).toEqual(["e3", "e2"]);
  });

  it("projectRepo.upsertByTitle 按归一化标题更新而不是新建", async () => {
    await projectRepo.upsertByTitle("朝暮 App", { note: "立项" }, new Date(2026, 8, 5));
    const again = await projectRepo.upsertByTitle("朝暮app", { note: "解析层联调完了" }, new Date(2026, 8, 6));
    const all = await projectRepo.list();
    expect(all).toHaveLength(1);
    expect(all[0].note).toBe("解析层联调完了");
    expect(again.id).toBe(all[0].id);
    expect(all[0].status).toBe("active");
  });

  it("waitingRepo 解决后不再出现在 listOpen", async () => {
    await waitingRepo.add({ id: "w1", text: "等房东答复", waitingOn: "房东", since: "2026-09-06T01:00:00.000Z", fromMessageId: "m1" });
    expect((await waitingRepo.listOpen()).map((w) => w.id)).toEqual(["w1"]);
    await waitingRepo.resolve("w1", new Date(2026, 8, 6, 18, 0, 0));
    expect(await waitingRepo.listOpen()).toEqual([]);
  });

  it("memoryRepo 增删查", async () => {
    await memoryRepo.add({ id: "mem1", text: "早上不开会", kind: "preference", createdAt: "2026-09-06T01:00:00.000Z" });
    expect((await memoryRepo.list()).map((m) => m.text)).toEqual(["早上不开会"]);
    await memoryRepo.remove("mem1");
    expect(await memoryRepo.list()).toEqual([]);
  });
```

文件顶部 import 改为：

```ts
import { chatRepo, deleteDb, eventRepo, logRepo, memoryRepo, projectRepo, todoRepo, waitingRepo } from "@/storage/db";
```

（以 db.test.ts 现有 import 行为准合并；新测试放在文件内现有 describe 里。）

- [ ] **Step 2: 写迁移失败测试** `src/__tests__/db-migration.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { deleteDb, eventRepo, todoRepo } from "@/storage/db";

// 模拟旧版本：手工以 v1 建库（只有 chats/todos/logs），写一条待办。
async function createV1WithTodo() {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("zhaomu", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("chats", { keyPath: "date" });
      db.createObjectStore("todos", { keyPath: "id" });
      db.createObjectStore("logs", { keyPath: "date" });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("todos", "readwrite");
      tx.objectStore("todos").put({
        id: "old-1",
        title: "旧版本留下的待办",
        status: "open",
        sourceDate: "2026-09-05",
        createdAt: "2026-09-05T01:00:00.000Z",
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("db v1 → v2 迁移", () => {
  it("旧数据保留，新 store 可用", async () => {
    await deleteDb();
    await createV1WithTodo();
    const todos = await todoRepo.list();
    expect(todos.map((t) => t.title)).toContain("旧版本留下的待办");
    expect(todos[0].priority).toBeUndefined();
    await expect(eventRepo.listRecent(3)).resolves.toEqual([]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/__tests__/db-migration.test.ts src/__tests__/db.test.ts`
Expected: FAIL（`eventRepo` 等未导出）

- [ ] **Step 4: 实现 db.ts 改动**

`DB_VERSION` 改为 `2`；`onupgradeneeded` 内追加：

```ts
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "id" });
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("waitings")) db.createObjectStore("waitings", { keyPath: "id" });
      if (!db.objectStoreNames.contains("memories")) db.createObjectStore("memories", { keyPath: "id" });
```

import 行更新（文件顶部）：

```ts
import { localDate, shiftLocalDate } from "../dates";
import { normKey } from "../norm";
import type { ChatMessage, DailyLog, DayChat, Memory, Project, TimelineEvent, Todo, Waiting } from "../types";
```

文件末尾追加四个仓储：

```ts
export const eventRepo = {
  async add(e: TimelineEvent): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("events", "readwrite");
    tx.objectStore("events").put(e);
    await txDone(tx);
    db.close();
  },
  async listRecent(days: number, now: Date = new Date()): Promise<TimelineEvent[]> {
    const db = await openDb();
    const rows = await new Promise<TimelineEvent[]>((resolve, reject) => {
      const req = db.transaction("events").objectStore("events").getAll();
      req.onsuccess = () => resolve(req.result as TimelineEvent[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const since = shiftLocalDate(localDate(now), -(days - 1));
    return rows
      .filter((e) => e.date >= since)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  },
};

export const projectRepo = {
  async list(): Promise<Project[]> {
    const db = await openDb();
    const rows = await new Promise<Project[]>((resolve, reject) => {
      const req = db.transaction("projects").objectStore("projects").getAll();
      req.onsuccess = () => resolve(req.result as Project[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  },
  async upsertByTitle(
    title: string,
    patch: { note?: string; status?: Project["status"] },
    now: Date = new Date(),
  ): Promise<Project> {
    const key = normKey(title);
    const existing = (await projectRepo.list()).find((p) => normKey(p.title) === key);
    const nowIso = now.toISOString();
    const next: Project = existing
      ? {
          ...existing,
          note: patch.note ?? existing.note,
          status: patch.status ?? existing.status,
          updatedAt: nowIso,
        }
      : {
          id: newId(),
          title: title.trim(),
          status: patch.status ?? "active",
          note: patch.note,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
    const db = await openDb();
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(next);
    await txDone(tx);
    db.close();
    return next;
  },
};

export const waitingRepo = {
  async add(w: Waiting): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("waitings", "readwrite");
    tx.objectStore("waitings").put(w);
    await txDone(tx);
    db.close();
  },
  async listOpen(): Promise<Waiting[]> {
    const db = await openDb();
    const rows = await new Promise<Waiting[]>((resolve, reject) => {
      const req = db.transaction("waitings").objectStore("waitings").getAll();
      req.onsuccess = () => resolve(req.result as Waiting[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.filter((w) => !w.resolvedAt);
  },
  async resolve(id: string, now: Date = new Date()): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("waitings", "readwrite");
    const store = tx.objectStore("waitings");
    const w = await new Promise<Waiting | undefined>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as Waiting | undefined);
      req.onerror = () => reject(req.error);
    });
    if (w) {
      w.resolvedAt = now.toISOString();
      store.put(w);
    }
    await txDone(tx);
    db.close();
  },
};

export const memoryRepo = {
  async add(m: Memory): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("memories", "readwrite");
    tx.objectStore("memories").put(m);
    await txDone(tx);
    db.close();
  },
  async list(): Promise<Memory[]> {
    const db = await openDb();
    const rows = await new Promise<Memory[]>((resolve, reject) => {
      const req = db.transaction("memories").objectStore("memories").getAll();
      req.onsuccess = () => resolve(req.result as Memory[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  },
  async remove(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("memories", "readwrite");
    tx.objectStore("memories").delete(id);
    await txDone(tx);
    db.close();
  },
};
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/__tests__/db.test.ts src/__tests__/db-migration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/storage/db.ts src/__tests__/db.test.ts src/__tests__/db-migration.test.ts
git commit -m "feat: IndexedDB 升 v2，新增 events/projects/waitings/memories 仓储"
```

---

### Task 3: 解析管道 `src/agent/parse.ts`

**Files:**
- Create: `src/agent/parse.ts`
- Test: `src/__tests__/parse.test.ts`

**Interfaces:**
- Consumes: `parseJsonObject`（`./parse-json`）、`debugLog`、`ChatCompletionRequest/Response`（`@/api/deepseek`）、Task 1 的类型
- Produces:
  - `emptyParseResult(): ParseResult`
  - `isChitchat(r: ParseResult): boolean`
  - `asParseResult(raw: unknown): ParseResult`（逐字段校验，非法条目丢弃，绝不抛）
  - `parseSystemPrompt(): string`
  - `parseUserContent(input: { text: string; date: string; todoTitles: string[]; projectTitles: string[] }): string`
  - `parseInput(args: { text: string; date: string; todos: { title: string }[]; projects: { title: string }[]; model: string; complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse> }): Promise<ParseResult>` — **永不抛异常**，失败记 debug `parse_fail` 并返回 `emptyParseResult()`

- [ ] **Step 1: 写失败测试** `src/__tests__/parse.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { ChatCompletionResponse } from "@/api/deepseek";
import { debugLog } from "@/debug/log";
import { asParseResult, emptyParseResult, isChitchat, parseInput, parseSystemPrompt } from "@/agent/parse";

describe("asParseResult", () => {
  it("非法输入返回全空", () => {
    expect(asParseResult(undefined)).toEqual(emptyParseResult());
    expect(asParseResult("不是对象")).toEqual(emptyParseResult());
    expect(asParseResult({ tasks: "boom" })).toEqual(emptyParseResult());
  });

  it("逐条校验，丢弃坏条目保留好条目", () => {
    const r = asParseResult({
      events: ["中午吃了螺蛳粉", 42, ""],
      decisions: ["定了用 Postgres"],
      tasks: [
        { title: " 明天下午三点前交稿 ", priority: "high", due: "2026-09-07", project: " 接私活 " },
        { title: "" },
        { title: "坏优先级", priority: "urgent" },
        "不是对象",
      ],
      projectUpdates: [{ project: "朝暮", note: "解析层联调完了", status: "active" }, { note: "没项目名" }],
      waitings: [{ text: "等房东答复", waitingOn: "房东" }, { waitingOn: "没文本" }],
      waitingsResolved: ["房东答复了", 1],
      memories: [{ text: "早上不开会", kind: "preference" }, { text: "坏类型", kind: "mood" }],
    });
    expect(r.events).toEqual(["中午吃了螺蛳粉"]);
    expect(r.decisions).toEqual(["定了用 Postgres"]);
    expect(r.tasks).toEqual([
      { title: "明天下午三点前交稿", reason: undefined, priority: "high", due: "2026-09-07", project: "接私活" },
      { title: "坏优先级", reason: undefined, priority: undefined, due: undefined, project: undefined },
    ]);
    expect(r.projectUpdates).toEqual([{ project: "朝暮", note: "解析层联调完了", status: "active" }]);
    expect(r.waitings).toEqual([{ text: "等房东答复", waitingOn: "房东" }]);
    expect(r.waitingsResolved).toEqual(["房东答复了"]);
    expect(r.memories).toEqual([{ text: "早上不开会", kind: "preference" }]);
  });
});

describe("isChitchat", () => {
  it("六类全空才算纯闲聊", () => {
    expect(isChitchat(emptyParseResult())).toBe(true);
    expect(isChitchat({ ...emptyParseResult(), events: ["有事"] })).toBe(false);
  });
});

describe("parseSystemPrompt", () => {
  it("写入了随口一说/长期记忆两条核心判定规则", () => {
    const p = parseSystemPrompt();
    expect(p).toContain("随口一说");
    expect(p).toContain("一个月后");
    expect(p).toContain("只输出一个 JSON 对象");
  });
});

describe("parseInput", () => {
  it("成功时返回解析结果", async () => {
    const complete = async (): Promise<ChatCompletionResponse> => ({
      content: '{"events":["下雨了"],"decisions":[],"tasks":[],"projectUpdates":[],"waitings":[],"waitingsResolved":[],"memories":[]}',
      tool_calls: [],
    });
    const r = await parseInput({ text: "下雨了", date: "2026-09-06", todos: [], projects: [], model: "m", complete });
    expect(r.events).toEqual(["下雨了"]);
  });

  it("输出不是 JSON 时不抛，记 parse_fail，返回全空", async () => {
    debugLog.clear();
    const complete = async (): Promise<ChatCompletionResponse> => ({ content: "聊得很好", tool_calls: [] });
    const r = await parseInput({ text: "hi", date: "2026-09-06", todos: [], projects: [], model: "m", complete });
    expect(r).toEqual(emptyParseResult());
    expect(debugLog.entries.some((e) => e.event === "parse_fail")).toBe(true);
  });

  it("网络失败时不抛，记 parse_fail，返回全空", async () => {
    debugLog.clear();
    const complete = async (): Promise<ChatCompletionResponse> => {
      throw new Error("没网");
    };
    const r = await parseInput({ text: "hi", date: "2026-09-06", todos: [], projects: [], model: "m", complete });
    expect(r).toEqual(emptyParseResult());
    expect(debugLog.entries.some((e) => e.event === "parse_fail")).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/parse.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/agent/parse.ts`**

```ts
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { debugLog } from "@/debug/log";
import type { MemoryCandidate, ParsedTask, ParsedWaiting, ParseResult, ProjectUpdate } from "@/types";
import { parseJsonObject } from "./parse-json";

export function emptyParseResult(): ParseResult {
  return {
    events: [],
    decisions: [],
    tasks: [],
    projectUpdates: [],
    waitings: [],
    waitingsResolved: [],
    memories: [],
  };
}

export function isChitchat(r: ParseResult): boolean {
  return (
    r.events.length +
      r.decisions.length +
      r.tasks.length +
      r.projectUpdates.length +
      r.waitings.length +
      r.waitingsResolved.length +
      r.memories.length ===
    0
  );
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asTasks(v: unknown): ParsedTask[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedTask[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const title = asString(o.title);
    if (!title) continue;
    out.push({
      title,
      reason: asString(o.reason),
      priority: o.priority === "high" ? "high" : o.priority === "normal" ? "normal" : undefined,
      due: asString(o.due),
      project: asString(o.project),
    });
  }
  return out;
}

function asProjectUpdates(v: unknown): ProjectUpdate[] {
  if (!Array.isArray(v)) return [];
  const out: ProjectUpdate[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const project = asString(o.project);
    const note = asString(o.note);
    if (!project || !note) continue;
    const status = o.status === "done" || o.status === "paused" || o.status === "active" ? o.status : undefined;
    out.push({ project, note, status });
  }
  return out;
}

function asWaitings(v: unknown): ParsedWaiting[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedWaiting[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const text = asString(o.text);
    if (!text) continue;
    out.push({ text, waitingOn: asString(o.waitingOn) });
  }
  return out;
}

function asMemories(v: unknown): MemoryCandidate[] {
  if (!Array.isArray(v)) return [];
  const out: MemoryCandidate[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const text = asString(o.text);
    const kind = o.kind === "preference" || o.kind === "goal" || o.kind === "watch" ? o.kind : undefined;
    if (!text || !kind) continue;
    out.push({ text, kind });
  }
  return out;
}

export function asParseResult(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object") return emptyParseResult();
  const o = raw as Record<string, unknown>;
  return {
    events: asStringList(o.events),
    decisions: asStringList(o.decisions),
    tasks: asTasks(o.tasks),
    projectUpdates: asProjectUpdates(o.projectUpdates),
    waitings: asWaitings(o.waitings),
    waitingsResolved: asStringList(o.waitingsResolved),
    memories: asMemories(o.memories),
  };
}

export function parseSystemPrompt(): string {
  return `你在为「朝暮」做输入解析。只输出一个 JSON 对象，不要 markdown，不要其它字。

把用户刚说的这句话拆成结构化信息：
- events: string[] 发生了什么（已发生的事实、见闻、状态），一句一条
- decisions: string[] 用户已经拍板的决定
- tasks: { "title": string, "reason"?: string, "priority"?: "high"|"normal", "due"?: string, "project"?: string }[] 用户自己要去做的行动
- projectUpdates: { "project": string, "note": string, "status"?: "active"|"done"|"paused" }[] 某个项目的进展；project 优先用现有项目标题，没有就起个短名；status 只在明确完结或暂停时给
- waitings: { "text": string, "waitingOn"?: string }[] 正在等别人或等外部条件的事
- waitingsResolved: string[] 这句话表明之前等待的事有了结果（按等待内容简述）
- memories: { "text": string, "kind": "preference"|"goal"|"watch" }[] 长期记忆候选

判断规则：
1. 随口一说不是 task：愿望（"好想…"）、假设（"要是有空…"）、吐槽、情绪、已发生无需行动的事、别人的事，都不是 task。只有用户自己要采取的行动才是 task。
2. 一个月后它还会影响你给用户的建议，才进 memories：preference 稳定偏好、goal 长期目标、watch 持续关注。单次事件、具体任务、临时状态（"今天累了"）一律不进。
3. due 用 ISO 日期（如 2026-09-07）；只有话里能推出具体时间时才给。
4. priority 只在明显要紧（紧迫截止、用户强调）时给 "high"。
5. 没有对应的类别就留空数组。纯闲聊六个数组全空。
6. 不要编造用户没说的内容。`;
}

export function parseUserContent(input: {
  text: string;
  date: string;
  todoTitles: string[];
  projectTitles: string[];
}): string {
  return [
    `今天是 ${input.date}。`,
    `现有待办：${input.todoTitles.length ? input.todoTitles.join("；") : "无"}。`,
    `现有项目：${input.projectTitles.length ? input.projectTitles.join("；") : "无"}。`,
    `用户刚说：「${input.text}」`,
    "只解析「用户刚说」这句，输出 JSON。",
  ].join("\n");
}

export async function parseInput(args: {
  text: string;
  date: string;
  todos: { title: string }[];
  projects: { title: string }[];
  model: string;
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
}): Promise<ParseResult> {
  try {
    const res = await args.complete({
      model: args.model,
      messages: [
        { role: "system", content: parseSystemPrompt() },
        {
          role: "user",
          content: parseUserContent({
            text: args.text,
            date: args.date,
            todoTitles: args.todos.map((t) => t.title),
            projectTitles: args.projects.map((p) => p.title),
          }),
        },
      ],
      tools: [],
      stream: false,
    });
    const raw = typeof res.content === "string" ? parseJsonObject(res.content) : undefined;
    if (raw === undefined) {
      debugLog.push({ event: "parse_fail", detail: "解析输出不是 JSON" });
      return emptyParseResult();
    }
    return asParseResult(raw);
  } catch (e) {
    debugLog.push({ event: "parse_fail", detail: e instanceof Error ? e.message : String(e) });
    return emptyParseResult();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/__tests__/parse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/parse.ts src/__tests__/parse.test.ts
git commit -m "feat: 独立解析管道（ParseResult 校验、判定规则提示词、失败不阻塞）"
```

---

### Task 4: 解析语料库 `src/agent/parse-corpus.ts`

**Files:**
- Create: `src/agent/parse-corpus.ts`
- Test: `src/__tests__/parse-corpus.test.ts`

**Interfaces:**
- Produces:
  - `interface CorpusCase { input: string; note?: string; expect: { tasks?: string[]; notTasks?: string[]; events?: string[]; decisions?: string[]; waitings?: string[]; memories?: { text: string; kind: "preference" | "goal" | "watch" }[]; notMemories?: string[]; chitchat?: boolean } }`
  - `PARSE_CORPUS: CorpusCase[]`（≥ 20 条）
- 消费者：Task 12 的 `scoreCase`（真实 API eval）与 `parse-corpus.test.ts`（完整性校验）。

- [ ] **Step 1: 写失败测试** `src/__tests__/parse-corpus.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { PARSE_CORPUS } from "@/agent/parse-corpus";

const EXPECT_KEYS = ["tasks", "notTasks", "events", "decisions", "waitings", "memories", "notMemories", "chitchat"];

describe("PARSE_CORPUS", () => {
  it("至少 20 条，覆盖随口一说与长期记忆两类区分", () => {
    expect(PARSE_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(PARSE_CORPUS.some((c) => (c.expect.notTasks?.length ?? 0) > 0)).toBe(true);
    expect(PARSE_CORPUS.some((c) => (c.expect.memories?.length ?? 0) > 0)).toBe(true);
    expect(PARSE_CORPUS.some((c) => (c.expect.notMemories?.length ?? 0) > 0)).toBe(true);
    expect(PARSE_CORPUS.some((c) => c.expect.chitchat === true)).toBe(true);
  });

  it("每条都有非空输入和至少一个断言", () => {
    for (const c of PARSE_CORPUS) {
      expect(c.input.trim().length).toBeGreaterThan(0);
      const assertions = EXPECT_KEYS.some((k) => {
        const v = (c.expect as Record<string, unknown>)[k];
        return Array.isArray(v) ? v.length > 0 : v === true;
      });
      expect(assertions, `语料「${c.input}」没有任何断言`).toBe(true);
    }
  });

  it("chitchat 不与其它断言混用，记忆类别合法", () => {
    for (const c of PARSE_CORPUS) {
      if (c.expect.chitchat) {
        expect(c.expect.tasks ?? []).toEqual([]);
        expect(c.expect.memories ?? []).toEqual([]);
      }
      for (const m of c.expect.memories ?? []) {
        expect(["preference", "goal", "watch"]).toContain(m.kind);
      }
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/parse-corpus.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/agent/parse-corpus.ts`**

```ts
/** 解析语料：随口一说 vs 真正待办、短期任务 vs 长期记忆 的判断基准。
 *  两个消费者：parse-corpus.test.ts（完整性）、eval/parse.eval.test.ts（真实 API 打分）。 */
export interface CorpusCase {
  input: string;
  note?: string;
  expect: {
    /** 应抽出的 task 标题关键词（包含匹配）。 */
    tasks?: string[];
    /** 不得成为 task 的表述。 */
    notTasks?: string[];
    /** 应记为 event 的关键词。 */
    events?: string[];
    decisions?: string[];
    waitings?: string[];
    memories?: { text: string; kind: "preference" | "goal" | "watch" }[];
    notMemories?: string[];
    /** 六类应全空。 */
    chitchat?: boolean;
  };
}

export const PARSE_CORPUS: CorpusCase[] = [
  // —— 随口一说 ≠ 真正待办 ——
  { input: "好想去看海啊", expect: { chitchat: true, notTasks: ["看海"], notMemories: ["看海"] } },
  { input: "要是有空真想学吉他", expect: { chitchat: true, notTasks: ["学吉他"], notMemories: ["吉他"] } },
  { input: "今天累死了，啥也不想干", expect: { events: ["累"], notTasks: ["累"], notMemories: ["累"] } },
  { input: "中午吃了螺蛳粉，太辣了", expect: { events: ["螺蛳粉"], notTasks: ["螺蛳粉"] } },
  { input: "我同事要跳槽了", expect: { events: ["同事"], notTasks: ["跳槽"] } },
  { input: "下周可能想出去走走", expect: { chitchat: true, notTasks: ["出去走走"] } },
  { input: "哈哈今天天气真好", expect: { chitchat: true } },
  { input: "你说我该不该换工作啊", expect: { chitchat: true, notTasks: ["换工作"] } },

  // —— 真正待办 ——
  { input: "明天下午三点前得把稿子交给编辑", expect: { tasks: ["稿"], notMemories: ["稿"] } },
  { input: "记得给妈妈回电话", expect: { tasks: ["回电话"] } },
  { input: "周五之前把车险续了，很急", expect: { tasks: ["车险"] } },
  { input: "晚上把垃圾带下楼", expect: { tasks: ["垃圾"] } },
  { input: "明天记得带伞，要下雨", expect: { tasks: ["带伞"], events: ["下雨"] } },

  // —— 短期任务 vs 长期记忆 ——
  {
    input: "以后早上别给我排会，我上午要写代码",
    expect: { memories: [{ text: "早上", kind: "preference" }], notTasks: ["排会"] },
  },
  { input: "今年要把小说初稿写完", expect: { memories: [{ text: "初稿", kind: "goal" }], notTasks: ["初稿"] } },
  { input: "帮我留意膝盖恢复的情况", expect: { memories: [{ text: "膝盖", kind: "watch" }], notTasks: ["膝盖"] } },
  { input: "年底想瘦五公斤", expect: { memories: [{ text: "瘦", kind: "goal" }] } },

  // —— 决定 / 事件 ——
  { input: "定了，数据库就用 Postgres", expect: { decisions: ["Postgres"], notTasks: ["Postgres"] } },
  {
    input: "今天开始戒糖",
    note: "边界：是决定；也可能被当成长期目标，二者都算对，但不许是 task",
    expect: { decisions: ["戒糖"], notTasks: ["戒糖"] },
  },

  // —— 项目 / 等待 ——
  {
    input: "朝暮项目的解析层联调完了，明天开始接 UI",
    expect: { events: ["联调"], tasks: ["接 UI"] },
  },
  { input: "房东说下周三前给我答复", expect: { waitings: ["答复"], notTasks: ["答复"] } },
  { input: "出版社还没回我邮件", expect: { waitings: ["邮件"] } },
  { input: "他回复我了，房租维持不变", note: "边界：独立一句话，至少应记 event", expect: { events: ["房租"] } },
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/__tests__/parse-corpus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/parse-corpus.ts src/__tests__/parse-corpus.test.ts
git commit -m "feat: 解析语料库（随口一说/真正待办、短期/长期的判断基准）"
```

---

### Task 5: 落库路由 `src/agent/route-parse.ts`

**Files:**
- Create: `src/agent/route-parse.ts`
- Test: `src/__tests__/route-parse.test.ts`

**Interfaces:**
- Consumes: Task 1 类型、`normKey`
- Produces:
  - `interface RouteDeps { addEvent(e: TimelineEvent): Promise<void>; upsertProject(title: string, patch: { note?: string; status?: Project["status"] }): Promise<void>; addWaiting(w: Waiting): Promise<void>; listOpenWaitings(): Promise<Waiting[]>; resolveWaiting(id: string): Promise<void>; listTodos(): Promise<Todo[]>; listMemories(): Promise<Memory[]>; now(): Date; newId(): string }`
  - `interface RouteOutcome { proposedTasks: ProposedTodo[]; memoryCandidates: MemoryCandidate[] }`
  - `routeParseResult(result: ParseResult, opts: { date: string; messageId: string }, deps: RouteDeps): Promise<RouteOutcome>`
- 路由规则：events/decisions → addEvent；projectUpdates → upsertProject；waitings → addWaiting；waitingsResolved → 与 open waitings 做 normKey 双向包含匹配，命中即 resolve；tasks 对现有待办去重后**返回待确认**（`when: "later"`）；memories 对现有记忆去重后**返回待确认**。

- [ ] **Step 1: 写失败测试** `src/__tests__/route-parse.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { routeParseResult, type RouteDeps } from "@/agent/route-parse";
import type { Memory, ProposedTodo, TimelineEvent, Todo, Waiting } from "@/types";
import { emptyParseResult } from "@/agent/parse";

function makeDeps(over?: Partial<RouteDeps>) {
  const events: TimelineEvent[] = [];
  const projects: { title: string; note?: string; status?: string }[] = [];
  const waitings: Waiting[] = [];
  const resolved: string[] = [];
  const deps: RouteDeps = {
    addEvent: async (e) => { events.push(e); },
    upsertProject: async (title, patch) => {
      const hit = projects.find((p) => p.title === title);
      if (hit) Object.assign(hit, patch);
      else projects.push({ title, ...patch });
    },
    addWaiting: async (w) => { waitings.push(w); },
    listOpenWaitings: async () => waitings.filter((w) => !w.resolvedAt),
    resolveWaiting: async (id) => { resolved.push(id); },
    listTodos: async () => [],
    listMemories: async () => [],
    now: () => new Date(2026, 8, 6, 10, 0, 0),
    newId: (() => { let i = 0; return () => `id-${++i}`; })(),
    ...over,
  };
  return { deps, events, projects, waitings, resolved };
}

const OPTS = { date: "2026-09-06", messageId: "m1" };

describe("routeParseResult", () => {
  it("events/decisions 进 Timeline，projectUpdates 进项目，waitings 进等待", async () => {
    const { deps, events, projects, waitings } = makeDeps();
    const r = {
      ...emptyParseResult(),
      events: ["中午吃了螺蛳粉"],
      decisions: ["定了用 Postgres"],
      projectUpdates: [{ project: "朝暮", note: "解析层联调完了" }],
      waitings: [{ text: "等房东答复", waitingOn: "房东" }],
    };
    const out = await routeParseResult(r, OPTS, deps);
    expect(events.map((e) => [e.kind, e.text])).toEqual([
      ["event", "中午吃了螺蛳粉"],
      ["decision", "定了用 Postgres"],
    ]);
    expect(events[0].fromMessageId).toBe("m1");
    expect(projects).toEqual([{ title: "朝暮", note: "解析层联调完了" }]);
    expect(waitings.map((w) => w.text)).toEqual(["等房东答复"]);
    expect(out.proposedTasks).toEqual([]);
    expect(out.memoryCandidates).toEqual([]);
  });

  it("tasks 与 memories 不落库，去重后返回待确认", async () => {
    const existing: Todo[] = [
      { id: "t1", title: "给妈妈回电话", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z" },
    ];
    const mems: Memory[] = [{ id: "m", text: "早上不开会", kind: "preference", createdAt: "2026-09-06T01:00:00.000Z" }];
    const { deps, events } = makeDeps({ listTodos: async () => existing, listMemories: async () => mems });
    const r = {
      ...emptyParseResult(),
      tasks: [
        { title: "给妈妈回电话" },
        { title: "明天下午三点前交稿", priority: "high" as const, due: "2026-09-07", project: "接私活" },
        { title: " 给 妈妈 回电话 " },
      ],
      memories: [
        { text: "早上不开会", kind: "preference" as const },
        { text: "今年写完初稿", kind: "goal" as const },
      ],
    };
    const out = await routeParseResult(r, OPTS, deps);
    expect(events).toEqual([]);
    expect(out.proposedTasks).toEqual([
      { title: "明天下午三点前交稿", reason: undefined, when: "later", priority: "high", due: "2026-09-07", project: "接私活" },
    ] satisfies ProposedTodo[]);
    expect(out.memoryCandidates).toEqual([{ text: "今年写完初稿", kind: "goal" }]);
  });

  it("waitingsResolved 按文本匹配解决等待", async () => {
    const { deps, waitings, resolved } = makeDeps();
    waitings.push({ id: "w1", text: "等房东答复房租", since: "2026-09-05T01:00:00.000Z", fromMessageId: "m0" });
    const r = { ...emptyParseResult(), waitingsResolved: ["房东答复了"] };
    await routeParseResult(r, OPTS, deps);
    expect(resolved).toEqual(["w1"]);
  });

  it("waitingsResolved 匹配不上时不动", async () => {
    const { deps, waitings, resolved } = makeDeps();
    waitings.push({ id: "w1", text: "等出版社回邮件", since: "2026-09-05T01:00:00.000Z", fromMessageId: "m0" });
    const r = { ...emptyParseResult(), waitingsResolved: ["快递到了"] };
    await routeParseResult(r, OPTS, deps);
    expect(resolved).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/route-parse.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/agent/route-parse.ts`**

```ts
import { normKey } from "@/norm";
import type {
  Memory,
  MemoryCandidate,
  ParseResult,
  Project,
  ProposedTodo,
  TimelineEvent,
  Todo,
  Waiting,
} from "@/types";

export interface RouteDeps {
  addEvent: (e: TimelineEvent) => Promise<void>;
  upsertProject: (title: string, patch: { note?: string; status?: Project["status"] }) => Promise<void>;
  addWaiting: (w: Waiting) => Promise<void>;
  listOpenWaitings: () => Promise<Waiting[]>;
  resolveWaiting: (id: string) => Promise<void>;
  listTodos: () => Promise<Todo[]>;
  listMemories: () => Promise<Memory[]>;
  now: () => Date;
  newId: () => string;
}

export interface RouteOutcome {
  /** 去重后的待确认任务（确认后才落库）。 */
  proposedTasks: ProposedTodo[];
  /** 去重后的待确认记忆候选（确认后才落库）。 */
  memoryCandidates: MemoryCandidate[];
}

/** 解析产出的路由：事实自动落 Timeline/State；任务与记忆只返回候选，等用户确认。 */
export async function routeParseResult(
  result: ParseResult,
  opts: { date: string; messageId: string },
  deps: RouteDeps,
): Promise<RouteOutcome> {
  const createdAt = deps.now().toISOString();
  for (const text of result.events) {
    await deps.addEvent({ id: deps.newId(), date: opts.date, createdAt, kind: "event", text, fromMessageId: opts.messageId });
  }
  for (const text of result.decisions) {
    await deps.addEvent({ id: deps.newId(), date: opts.date, createdAt, kind: "decision", text, fromMessageId: opts.messageId });
  }
  for (const u of result.projectUpdates) {
    await deps.upsertProject(u.project, { note: u.note, status: u.status });
  }
  for (const w of result.waitings) {
    await deps.addWaiting({ id: deps.newId(), text: w.text, waitingOn: w.waitingOn, since: createdAt, fromMessageId: opts.messageId });
  }
  if (result.waitingsResolved.length > 0) {
    const open = await deps.listOpenWaitings();
    for (const text of result.waitingsResolved) {
      const key = normKey(text);
      const hit = open.find((w) => {
        const wk = normKey(w.text);
        return wk.includes(key) || key.includes(wk);
      });
      if (hit) await deps.resolveWaiting(hit.id);
    }
  }

  const todos = await deps.listTodos();
  const seenTodos = new Set(todos.map((t) => normKey(t.title)));
  const proposedTasks: ProposedTodo[] = [];
  for (const t of result.tasks) {
    const key = normKey(t.title);
    if (!key || seenTodos.has(key)) continue;
    seenTodos.add(key);
    proposedTasks.push({
      title: t.title,
      reason: t.reason,
      when: "later",
      priority: t.priority,
      due: t.due,
      project: t.project,
    });
  }

  const memories = await deps.listMemories();
  const seenMem = new Set(memories.map((m) => normKey(m.text)));
  const memoryCandidates: MemoryCandidate[] = [];
  for (const m of result.memories) {
    const key = normKey(m.text);
    if (!key || seenMem.has(key)) continue;
    seenMem.add(key);
    memoryCandidates.push(m);
  }

  return { proposedTasks, memoryCandidates };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/__tests__/route-parse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/route-parse.ts src/__tests__/route-parse.test.ts
git commit -m "feat: 解析产出路由（事实自动落库，任务/记忆只出确认候选）"
```

---

### Task 6: 回复循环精简（移除 propose_todos / suggest_order）

**Files:**
- Modify: `src/agent/tools.ts`、`src/agent/loop.ts`、`src/agent/prompt.ts`
- Test: `src/__tests__/loop.test.ts`

**Interfaces:**
- Consumes: Task 1 类型
- Produces: `TOOL_DEFS` 只剩 `list_todos` 与 `set_today_plan`；`AgentDeps.onPropose` 的 kind 参数类型放宽为 `"later" | "today" | "memory"`（loop 自身只传 `"today"`）

- [ ] **Step 1: 改写失败测试**

`src/__tests__/loop.test.ts` 中，把 `"does not write todos until onPropose returns them"` 这个用例整体替换为：

```ts
  it("propose_todos 已移除：调用返回未知工具，不写任何待办", async () => {
    const added: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "propose_todos", arguments: JSON.stringify({ items: [{ title: "给房东转水电费" }] }) },
              },
            ],
          };
        }
        return { content: "好。", tool_calls: [] };
      },
      addTodos: async (items) => {
        added.push(...items.map((i) => i.title));
      },
    });
    const r = await runAgent({ deps: d, mode: "chat", userText: "还要给房东转水电费", history: [], model: "deepseek-v4-flash" });
    expect(added).toEqual([]);
    expect(r.assistantText).toBe("好。");
  });
```

并删除该文件中不再使用的 `ChatCompletionRequest` import（如只剩这一处用到的话——`ChatCompletionRequest` 在 `puts yesterday's diary` 用例里还用，保留）。`deps()` 的 `onPropose` 签名不变。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/loop.test.ts`
Expected: FAIL（旧行为下 `propose_todos` 仍走确认流，added 虽为空但 assistantText 走的是 confirm 分支；移除后应为「好。」——移除前该断言失败）

- [ ] **Step 3: 精简 tools.ts**

`src/agent/tools.ts` 只保留两个工具：

```ts
import type { ToolDef } from "@/api/deepseek";

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_todos",
      description: "读取当前待办：今天、以后、今日已完成。没有勾掉任务的能力。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_today_plan",
      description: "提议今天做哪几件。可以是已有标题或新标题。用户确认后才会刷新今天的清单，当前这段对话也会结束并清空；没选上的今天事项掉回以后。",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                reason: { type: "string" },
              },
              required: ["title"],
            },
          },
        },
        required: ["items"],
      },
    },
  },
];
```

- [ ] **Step 4: 精简 loop.ts**

- `executeTool` 删除 `propose_todos` 与 `suggest_order` 两个分支（保留 `list_todos`、`set_today_plan`、最后的「未知工具」）。
- 删除不再使用的 import：`filterProposedTodos`（`filterTodayPlanItems` 保留）。
- `AgentDeps` 的 `onPropose` 类型改为：

```ts
  onPropose: (items: ProposedTodo[], kind: "later" | "today" | "memory") => Promise<ProposedTodo[]>;
```

- [ ] **Step 5: 改写 systemPrompt（`src/agent/prompt.ts`）**

只替换 `systemPrompt` 函数，其余导出不动：

```ts
export function systemPrompt(): string {
  return `你是「朝暮」，一个只专注「今天」的整理秘书：陪用户把今天理顺。不要人生建议，不要写日记。

系统会自动解析用户每句话：发生了什么、要做的事、项目进展、等待中的事、长期记忆候选，都由系统落库或弹确认框，你不用管抽取，也不要重复提议这些事项。

怎么看局面：
1. 开口前先对照上下文里的三层待办（今天 / 以后 / 今日已完成）、进行中的项目、等待中的事、长期记忆，以及昨天的日记（如果有），不许装作没看见。
2. 待办列表是唯一真相。有没有完成，只看上面的分区，不要根据聊天记录判断。以后不算没做完。

主动职责：
1. 用户冒出新的事，先对照今天已有的负荷给取舍建议：今天已经排了不少，就建议先别进今天。
2. 信息不够就追问，每次只问一个问题，问完即止，等用户回答。先问最关键的：截止时间，其次重要程度，其次大概耗时。
3. 今日计划宜少不宜多。只列入当天最要紧的 1～3 件，其余留在以后。
4. 用户要求把今天和以后一起重新整理时，调 set_today_plan 列出今天这几件，等用户确认。

主动开场（系统提示用户今天第一次打开、还一句话没说时）：
1. 结合昨天的日记（如有）和三层待办，用一两句说出今天建议怎么安排。
2. 再问一个最值得回答的问题，等用户回答。
3. 今天该做什么已经很明显时，可以直接调 set_today_plan 提议；不够明显就先聊，别硬排。
4. 如果第一次开口已是傍晚或晚上，别再立今天的计划，改成帮他记下今天发生的、明天要做的事。

硬规则：
1. 不得声称已经写入待办、记忆或日记。新事项与记忆由系统弹确认框，用户确认后才会写入。
2. 仅当用户明确要求「改成今天做这些」时才调 set_today_plan。
3. 用户确认今日计划后，本段对话即告结束，界面会清空。不要寒暄收尾，不要再追问。
4. 日记由用户在日记页自行生成，对话中不要写日记。`;
}
```

注意：必须保留 `prompt.test.ts` 断言的字符串：`昨天的日记`、`截止时间`、`每次只问一个问题`、`主动开场`、`不得声称已经写入`、`不要写日记`、`本段对话即告结束`（上面的文本已包含）。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/__tests__/loop.test.ts src/__tests__/prompt.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools.ts src/agent/loop.ts src/agent/prompt.ts src/__tests__/loop.test.ts
git commit -m "feat: 回复循环移除 propose_todos/suggest_order，抽取职责归解析层"
```

---

### Task 7: Context Builder P1（三块摘要 + 历史截断）

**Files:**
- Modify: `src/agent/context.ts`、`src/agent/loop.ts`（runAgent 透传）
- Test: `src/__tests__/context.test.ts`

**Interfaces:**
- Consumes: Task 1 类型
- Produces:
  - `HISTORY_LIMIT = 12`（context.ts 导出）
  - `buildContextMessages` 输入新增 `projects?: Project[]`、`waitings?: Waiting[]`、`memories?: Memory[]`；历史截断为 `messages.slice(-HISTORY_LIMIT)`
  - `runAgent` 输入新增同名三个可选字段，透传给 buildContextMessages

- [ ] **Step 1: 写失败测试（追加到 `src/__tests__/context.test.ts`）**

先看该文件现有用例的构造方式，保持同风格。新增：

```ts
  it("注入项目、等待中、长期记忆三块摘要", () => {
    const msgs = buildContextMessages({
      date: "2026-09-06",
      timeLabel: "上午 10:00",
      mode: "chat",
      todayTodos: [],
      laterTodos: [],
      doneToday: [],
      messages: [],
      planConfirmed: false,
      projects: [
        { id: "p1", title: "朝暮", status: "active", note: "解析层联调完了", createdAt: "", updatedAt: "" },
        { id: "p2", title: "旧项目", status: "done", createdAt: "", updatedAt: "" },
      ],
      waitings: [{ id: "w1", text: "等房东答复", waitingOn: "房东", since: "", fromMessageId: "m" }],
      memories: [{ id: "m1", text: "早上不开会", kind: "preference", createdAt: "" }],
    });
    const facts = msgs[0].content as string;
    expect(facts).toContain("进行中的项目 1 个");
    expect(facts).toContain("朝暮（解析层联调完了）");
    expect(facts).not.toContain("旧项目");
    expect(facts).toContain("等待中 1 件：等房东答复（等房东）");
    expect(facts).toContain("长期记忆 1 条：[偏好]早上不开会");
  });

  it("聊天历史截断为最近 12 条", async () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      role: "user",
      content: `第${i}句`,
      createdAt: "2026-09-06T01:00:00.000Z",
    }));
    const msgs = buildContextMessages({
      date: "2026-09-06",
      timeLabel: "上午 10:00",
      mode: "chat",
      todayTodos: [],
      laterTodos: [],
      doneToday: [],
      messages,
      planConfirmed: false,
    });
    const contents = msgs.map((m) => m.content).join("\n");
    expect(contents).not.toContain("第0句");
    expect(contents).not.toContain("第7句");
    expect(contents).toContain("第8句");
    expect(contents).toContain("第19句");
  });
```

（`ChatMessage` import 若缺失则补上。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/context.test.ts`
Expected: FAIL（新字段未注入、未截断）

- [ ] **Step 3: 实现 context.ts 改动**

`src/agent/context.ts` 全文替换为：

```ts
import type { ApiMessage } from "@/api/deepseek";
import {
  MEMORY_KIND_LABEL,
  type ChatMessage,
  type ChatMode,
  type DailyLog,
  type Memory,
  type Project,
  type Todo,
  type Waiting,
} from "@/types";

/** 注入的聊天历史上限：事实已被解析层抽走，历史只负责语气与连贯。 */
export const HISTORY_LIMIT = 12;

function modeLabel(mode: ChatMode): string {
  if (mode === "chat") return "闲聊";
  return "整理今日待办";
}

function titles(todos: Todo[]): string {
  return todos.map((t) => t.title).join("；");
}

function formatBucket(label: string, todos: Todo[]): string {
  if (todos.length === 0) return `${label} 0 件。`;
  return `${label} ${todos.length} 件：${titles(todos)}。`;
}

function formatYesterdayLog(log: DailyLog): string {
  const done = log.done.length ? log.done.join("；") : "无";
  const undone = log.undone.length ? log.undone.join("；") : "无";
  return `昨天的日记：计划「${log.plan}」；做成了：${done}；没做完：${undone}；状态：${log.state}。`;
}

function formatProjects(projects: Project[]): string {
  const active = projects.filter((p) => p.status === "active");
  if (active.length === 0) return "进行中的项目 0 个。";
  return `进行中的项目 ${active.length} 个：${active.map((p) => (p.note ? `${p.title}（${p.note}）` : p.title)).join("；")}。`;
}

function formatWaitings(waitings: Waiting[]): string {
  if (waitings.length === 0) return "等待中 0 件。";
  return `等待中 ${waitings.length} 件：${waitings.map((w) => (w.waitingOn ? `${w.text}（等${w.waitingOn}）` : w.text)).join("；")}。`;
}

function formatMemories(memories: Memory[]): string {
  if (memories.length === 0) return "长期记忆 0 条。";
  return `长期记忆 ${memories.length} 条：${memories.map((m) => `[${MEMORY_KIND_LABEL[m.kind]}]${m.text}`).join("；")}。`;
}

export function buildContextMessages(input: {
  date: string;
  timeLabel: string;
  mode: ChatMode;
  todayTodos: Todo[];
  laterTodos: Todo[];
  doneToday: Todo[];
  messages: ChatMessage[];
  planConfirmed: boolean;
  yesterdayLog?: DailyLog | null;
  projects?: Project[];
  waitings?: Waiting[];
  memories?: Memory[];
}): ApiMessage[] {
  const facts = [
    `今天是 ${input.date}，${input.timeLabel}。当前模式：${modeLabel(input.mode)}。`,
    input.planConfirmed ? "今天已经确认过今日计划。" : "今天还没有确认过今日计划。",
    input.yesterdayLog ? formatYesterdayLog(input.yesterdayLog) : "",
    formatBucket("今天", input.todayTodos),
    formatBucket("以后", input.laterTodos),
    formatBucket("今日已完成", input.doneToday),
    formatProjects(input.projects ?? []),
    formatWaitings(input.waitings ?? []),
    formatMemories(input.memories ?? []),
    "待办列表是唯一真相。有没有完成，只看上面的分区，不要根据聊天记录判断。以后不算没做完。",
  ].join("");
  const history: ApiMessage[] = input.messages.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [{ role: "system", content: facts }, ...history];
}
```

`src/agent/loop.ts` 的 `runAgent` 输入类型与调用：

```ts
export async function runAgent(input: {
  deps: AgentDeps;
  mode: ChatMode;
  userText: string;
  history: ChatMessage[];
  model: string;
  planConfirmed?: boolean;
  yesterdayLog?: DailyLog | null;
  projects?: Project[];
  waitings?: Waiting[];
  memories?: Memory[];
}): Promise<{ assistantText: string; stopped: boolean }> {
```

`buildContextMessages` 调用处追加 `projects: input.projects ?? [], waitings: input.waitings ?? [], memories: input.memories ?? []`；import 行补上 `Project, Waiting, Memory` 类型。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/__tests__/context.test.ts src/__tests__/loop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/context.ts src/agent/loop.ts src/__tests__/context.test.ts
git commit -m "feat: 上下文注入项目/等待/长期记忆摘要，聊天历史截断为最近 12 条"
```

---

### Task 8: 确认框徽标 + todo-meta 工具

**Files:**
- Create: `src/todo-meta.ts`
- Modify: `src/components/TodoConfirm.vue`、`src/screens/ChatScreen.vue`
- Test: `src/__tests__/todo-meta.test.ts`（新建）、`src/__tests__/chat-screen.test.ts`（扩展）

**Interfaces:**
- Produces:
  - `dueLabel(due: string, today: string): string`（逾期/今天/明天/M月D日；非法原样返回）
  - `todoMeta(input: { priority?: "high" | "normal"; due?: string; project?: string; tag?: string }, today: string): string`（`急 · 明天 · 项目名` 形式，空则返回 ""）
  - `ChatScreen` 的 `proposeKind` 支持 `"memory"`，渲染记忆确认框

- [ ] **Step 1: 写失败测试** `src/__tests__/todo-meta.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { dueLabel, todoMeta } from "@/todo-meta";

describe("dueLabel", () => {
  const today = "2026-09-06";
  it("逾期/今天/明天/更远", () => {
    expect(dueLabel("2026-09-05", today)).toBe("已逾期");
    expect(dueLabel("2026-09-06", today)).toBe("今天");
    expect(dueLabel("2026-09-06T15:00:00", today)).toBe("今天");
    expect(dueLabel("2026-09-07", today)).toBe("明天");
    expect(dueLabel("2026-10-01", today)).toBe("10月1日");
  });
  it("非法格式原样返回", () => {
    expect(dueLabel("下周三", today)).toBe("下周三");
  });
});

describe("todoMeta", () => {
  it("拼接 急/截止/项目/标签", () => {
    expect(todoMeta({ priority: "high", due: "2026-09-07", project: "接私活" }, "2026-09-06")).toBe("急 · 明天 · 接私活");
    expect(todoMeta({ tag: "偏好" }, "2026-09-06")).toBe("偏好");
    expect(todoMeta({}, "2026-09-06")).toBe("");
    expect(todoMeta({ priority: "normal" }, "2026-09-06")).toBe("");
  });
});
```

`src/__tests__/chat-screen.test.ts` 追加：

```ts
  it("memory 确认框用记忆文案并展示类别标签", () => {
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: true,
        pendingPropose: [{ title: "早上不开会", tag: "偏好" }],
        proposeKind: "memory",
      },
    });
    expect(w.text()).toContain("记进长期记忆吗？");
    expect(w.text()).toContain("记住");
    expect(w.text()).toContain("偏好");
  });

  it("later 确认框展示 急/截止/项目 徽标", () => {
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: true,
        pendingPropose: [{ title: "明天下午三点前交稿", when: "later", priority: "high", due: "2099-01-02", project: "接私活" }],
        proposeKind: "later",
      },
    });
    expect(w.text()).toContain("记到「以后」吗？");
    expect(w.text()).toContain("急");
    expect(w.text()).toContain("接私活");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/todo-meta.test.ts src/__tests__/chat-screen.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `src/todo-meta.ts`**

```ts
import { shiftLocalDate } from "./dates";

/** 截止时间的人话标签：已逾期 / 今天 / 明天 / M月D日；非法格式原样返回。 */
export function dueLabel(due: string, today: string): string {
  const day = due.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return due;
  if (day < today) return "已逾期";
  if (day === today) return "今天";
  if (day === shiftLocalDate(today, 1)) return "明天";
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
}

/** 确认框与待办行共用的徽标行：急 · 截止 · 项目 · 标签。 */
export function todoMeta(
  input: { priority?: "high" | "normal"; due?: string; project?: string; tag?: string },
  today: string,
): string {
  const parts: string[] = [];
  if (input.priority === "high") parts.push("急");
  if (input.due) parts.push(dueLabel(input.due, today));
  if (input.project) parts.push(input.project);
  if (input.tag) parts.push(input.tag);
  return parts.join(" · ");
}
```

- [ ] **Step 4: TodoConfirm.vue 加徽标**

模板里三处 `{{ ...title }}` 的 label 都改为带徽标的形式。分组分支：

```html
          <label v-for="i in todayIdxs" :key="`t-${i}`" class="todo-pick">
            <input v-model="checked[i]" type="checkbox" />
            <span>{{ items[i].title }}</span>
            <span v-if="metaFor(items[i])" class="todo-meta">{{ metaFor(items[i]) }}</span>
          </label>
          <p v-if="laterIdxs.length" class="propose-group">以后</p>
          <label v-for="i in laterIdxs" :key="`l-${i}`" class="todo-pick">
            <input v-model="checked[i]" type="checkbox" />
            <span>{{ items[i].title }}</span>
            <span v-if="metaFor(items[i])" class="todo-meta">{{ metaFor(items[i]) }}</span>
          </label>
```

平铺分支：

```html
          <label v-for="(it, i) in items" :key="i" class="todo-pick">
            <input v-model="checked[i]" type="checkbox" />
            <span>{{ it.title }}</span>
            <span v-if="metaFor(it)" class="todo-meta">{{ metaFor(it) }}</span>
          </label>
```

script 里加：

```ts
import { localDate } from "@/dates";
import { todoMeta } from "@/todo-meta";

function metaFor(it: ProposedTodo): string {
  return todoMeta({ priority: it.priority, due: it.due, project: it.project, tag: it.tag }, localDate());
}
```

- [ ] **Step 5: ChatScreen.vue 加 memory 分支**

`proposeKind` prop 类型改为 `"later" | "today" | "memory"`。模板里在两个 TodoConfirm 之间插入（顺序：today → memory → later）：

```html
      <TodoConfirm
        v-else-if="pendingPropose && proposeKind === 'memory'"
        :items="pendingPropose"
        heading="记进长期记忆吗？"
        yes-label="记住"
        no-label="不用记"
        note="长期记忆会影响以后每轮对话的建议。"
        @confirm="emit('confirm', $event)"
        @skip="emit('skip')"
      />
```

- [ ] **Step 6: styles.css 加徽标样式（追加到文件末尾）**

```css
.todo-meta {
  font-size: 12px;
  opacity: 0.6;
  margin-left: 6px;
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run src/__tests__/todo-meta.test.ts src/__tests__/chat-screen.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/todo-meta.ts src/components/TodoConfirm.vue src/screens/ChatScreen.vue src/styles.css src/__tests__/todo-meta.test.ts src/__tests__/chat-screen.test.ts
git commit -m "feat: 确认框展示 急/截止/项目 徽标，支持长期记忆确认"
```

---

### Task 9: App.vue 全流程接线 + 待办页徽标

**Files:**
- Modify: `src/App.vue`、`src/screens/TodoScreen.vue`、`src/components/TodoRow.vue`
- Test: `src/__tests__/parse-flow-app.test.ts`（新建）、`src/__tests__/todo-row.test.ts`（扩展）

**Interfaces:**
- Consumes: Task 2 仓储、Task 3 `parseInput`、Task 5 `routeParseResult`、Task 8 `todoMeta`
- Produces: runTurn 新流程（见下）；`TodoScreen` 新 prop `projects?: Project[]`；`TodoRow` 新 prop `projectTitle?: string`

runTurn 的目标流程（非 silent 轮）：

```
构造 userMsg（含 id）→ appendMessage
→ parseInput({ text, date, todos, projects, model, complete })
→ routeParseResult(result, { date, messageId: userMsg.id }, routeDeps)
→ refreshState()（projects/waitings/memories 三个 ref 重载）
→ proposedTasks 非空 → onPropose(tasks, "later") → 确认后 addTodos（落 priority/due/projectId）
→ memoryCandidates 非空 → onPropose(映射为 { title: text, tag: 类别label }, "memory") → 确认后 memoryRepo.add
→ runAgent（多传 projects/waitings/memories）
```

- [ ] **Step 1: 写失败测试（App 级端到端）** `src/__tests__/parse-flow-app.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions } from "@/api/deepseek";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { localDate } from "@/dates";
import { deleteDb, memoryRepo, projectRepo, todoRepo, waitingRepo, eventRepo } from "@/storage/db";
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

/** 区分解析调用（tools 为空）与回复调用（带工具）。 */
function mockPipeline(parseJson: string, reply: string) {
  vi.mocked(chatCompletions).mockImplementation(
    async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
      if (req.tools.length === 0) return { content: parseJson, tool_calls: [] };
      return { content: reply, tool_calls: [] };
    },
  );
}

describe("解析 → 确认 → 落库", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
  });

  it("任务经确认框落库并带 priority/due/项目；事件与等待自动落库", async () => {
    mockPipeline(
      JSON.stringify({
        events: ["解析层联调完了"],
        decisions: [],
        tasks: [{ title: "明天下午三点前交稿", priority: "high", due: "2099-01-02", project: "接私活" }],
        projectUpdates: [{ project: "接私活", note: "快到截止了" }],
        waitings: [{ text: "等房东答复", waitingOn: "房东" }],
        waitingsResolved: [],
        memories: [],
      }),
      "已记下。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("明天下午三点前得交稿，接私活那个项目快截止了，房东那边还等答复");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("记到「以后」吗？"));
    expect(w.text()).toContain("急");
    expect(w.text()).toContain("接私活");
    await w.get(".btn-yes").trigger("click");
    await waitFor(() => w.text().includes("已记下。"));
    const todos = await todoRepo.list();
    expect(todos).toHaveLength(1);
    expect(todos[0].priority).toBe("high");
    expect(todos[0].due).toBe("2099-01-02");
    const projects = await projectRepo.list();
    expect(projects.map((p) => p.title)).toEqual(["接私活"]);
    expect(todos[0].projectId).toBe(projects[0].id);
    expect((await waitingRepo.listOpen()).map((x) => x.text)).toEqual(["等房东答复"]);
    expect((await eventRepo.listRecent(1)).map((e) => e.text)).toEqual(["解析层联调完了"]);
  });

  it("纯闲聊不弹任何确认框", async () => {
    mockPipeline("{}", "哈哈是啊。");
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("今天天气真好");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("哈哈是啊。"));
    expect(w.text()).not.toContain("记到「以后」吗？");
    expect(w.text()).not.toContain("记进长期记忆吗？");
    expect(await todoRepo.list()).toEqual([]);
  });

  it("记忆候选经确认落 memories；跳过则不落", async () => {
    mockPipeline(
      JSON.stringify({
        events: [], decisions: [], tasks: [], projectUpdates: [], waitings: [], waitingsResolved: [],
        memories: [{ text: "早上不开会", kind: "preference" }],
      }),
      "记住了。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("以后早上别给我排会");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("记进长期记忆吗？"));
    await w.get(".btn-no").trigger("click");
    await waitFor(() => w.text().includes("记住了。"));
    expect(await memoryRepo.list()).toEqual([]);
  });

  it("解析失败（非 JSON）时对话照常", async () => {
    mockPipeline("聊得很好", "回复来了。");
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("随便说点啥");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("回复来了。"));
    expect(await todoRepo.list()).toEqual([]);
  });
});
```

注意：App 挂载时会跑 `maybeGreet`（silent kickoff），它不调 parse，但会调回复循环——mockPipeline 对回复调用的统一回复会作为开场白落一条助手消息，不影响以上断言（断言用 `includes` 且确认框文案足够特定）。若 greeting 干扰，可在 beforeEach 里先不挂 API key——App 的 `maybeGreet` 在没 key 时直接 return。本测试文件没有设置 key 的逻辑，`effectiveApiKey` 依赖内置调试 key 文件（`.gitignore` 忽略、本地存在）。**CI/他人机器上该文件不存在时 greeting 会跳过，行为一致**；若本地 greeting 真的干扰了某个断言，把 `mockPipeline` 的 reply 改成不含断言关键词的固定串即可。

`src/__tests__/todo-row.test.ts` 追加（先看现有用例风格）：

```ts
  it("展示 priority/due/项目 徽标", () => {
    const w = mount(TodoRow, {
      props: {
        todo: {
          id: "1",
          title: "交稿",
          status: "open",
          sourceDate: "2026-09-06",
          createdAt: "2026-09-06T01:00:00.000Z",
          priority: "high",
          due: "2099-01-02",
        },
        projectTitle: "接私活",
      },
    });
    expect(w.text()).toContain("急");
    expect(w.text()).toContain("1月2日");
    expect(w.text()).toContain("接私活");
  });
```

（due 用远期日期避免「已逾期/今天」随运行日变化。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/parse-flow-app.test.ts src/__tests__/todo-row.test.ts`
Expected: FAIL（流程未接线 / prop 不存在）

- [ ] **Step 3: App.vue 接线**

import 追加：

```ts
import { parseInput } from "@/agent/parse";
import { routeParseResult, type RouteDeps } from "@/agent/route-parse";
import { eventRepo, memoryRepo, projectRepo, waitingRepo } from "@/storage/db";
import { MEMORY_KIND_LABEL, type Memory, type MemoryCandidate, type Project, type Waiting } from "@/types";
```

（与现有 import 合并，重复的不重复引。）

state 追加：

```ts
const projects = ref<Project[]>([]);
const waitings = ref<Waiting[]>([]);
const memories = ref<Memory[]>([]);
let pendingMemoryCandidates: MemoryCandidate[] = [];
```

`ready` 里 `todos.value = await todoRepo.list();` 后追加：

```ts
  projects.value = await projectRepo.list();
  waitings.value = await waitingRepo.listOpen();
  memories.value = await memoryRepo.list();
```

加：

```ts
async function refreshState() {
  projects.value = await projectRepo.list();
  waitings.value = await waitingRepo.listOpen();
  memories.value = await memoryRepo.list();
}

const routeDeps: RouteDeps = {
  addEvent: (e) => eventRepo.add(e),
  upsertProject: (title, patch) => projectRepo.upsertByTitle(title, patch).then(() => undefined),
  addWaiting: (w) => waitingRepo.add(w),
  listOpenWaitings: () => waitingRepo.listOpen(),
  resolveWaiting: (id) => waitingRepo.resolve(id),
  listTodos: () => todoRepo.list(),
  listMemories: () => memoryRepo.list(),
  now: () => new Date(),
  newId,
};
```

`addTodos` 改为写扩展字段：

```ts
async function addTodos(items: ProposedTodo[]) {
  const sourceDate = localDate();
  const createdAt = new Date().toISOString();
  for (const item of items) {
    const project = item.project
      ? projects.value.find((p) => normKey(p.title) === normKey(item.project ?? ""))
      : undefined;
    await todoRepo.add({
      id: newId(),
      title: item.title,
      status: "open",
      sourceDate,
      createdAt,
      when: "later",
      priority: item.priority,
      due: item.due,
      projectId: project?.id,
    });
  }
  todos.value = await todoRepo.list();
}
```

（import `normKey` from "@/norm"。）

`onPropose` 的 kind 参数类型改为 `"later" | "today" | "memory"`；`proposeKind` ref 类型同步。

`runTurn` 中，把「appendMessage 用户消息」改为先构造对象拿到 id，并在其后插入解析与确认流程；`runAgent` 调用多传三个字段：

```ts
  try {
    let userMsg: ChatMessage | null = null;
    if (!opts?.silent) {
      userMsg = {
        id: newId(),
        role: "user",
        content: userText,
        createdAt: new Date().toISOString(),
        mode,
      };
      await appendMessage(userMsg);
    }
    if (userMsg) {
      const parseResult = await parseInput({
        text: userText,
        date: date.value,
        todos: todos.value,
        projects: projects.value,
        model: settings.value.model,
        complete,
      });
      const routed = await routeParseResult(parseResult, { date: date.value, messageId: userMsg.id }, routeDeps);
      await refreshState();
      if (routed.proposedTasks.length > 0) {
        const accepted = await onPropose(routed.proposedTasks, "later");
        if (accepted.length > 0) {
          await addTodos(accepted);
          debugLog.push({ event: "todo_confirmed", tool: "parse", detail: accepted.map((a) => a.title).join("、") });
        } else {
          debugLog.push({ event: "todo_rejected", tool: "parse", detail: "用户这次不加" });
        }
      }
      if (routed.memoryCandidates.length > 0) {
        pendingMemoryCandidates = routed.memoryCandidates;
        const accepted = await onPropose(
          routed.memoryCandidates.map((m) => ({ title: m.text, tag: MEMORY_KIND_LABEL[m.kind] })),
          "memory",
        );
        for (const a of accepted) {
          const m = pendingMemoryCandidates.find((x) => x.text === a.title);
          if (m) await memoryRepo.add({ id: newId(), text: m.text, kind: m.kind, createdAt: new Date().toISOString() });
        }
        pendingMemoryCandidates = [];
        await refreshState();
      }
    }
    const yesterdayLog = await logRepo.get(shiftLocalDate(date.value, -1));
    const { assistantText } = await runAgent({
      deps: agentDeps,
      mode,
      userText,
      history,
      model: settings.value.model,
      planConfirmed: !!chat.value.planConfirmedAt,
      yesterdayLog,
      projects: projects.value,
      waitings: waitings.value,
      memories: memories.value,
    });
```

（其后 appendMessage 助手消息等原有逻辑不动。）

模板里 TodoScreen 与 SettingsScreen 改为：

```html
      <TodoScreen
        v-else-if="tab === 'todo'"
        :todos="todos"
        :projects="projects"
        @toggle="onToggle"
        @remove="onRemove"
        @move="onMove"
      />
```

```html
      <SettingsScreen v-else :settings="settings" :memories="memories" @save="onSaveSettings" />
```

- [ ] **Step 4: TodoScreen / TodoRow 徽标**

`TodoScreen.vue`：props 改为 `defineProps<{ todos: Todo[]; projects?: Project[] }>()`；加：

```ts
const projectTitles = computed(() => new Map((props.projects ?? []).map((p) => [p.id, p.title])));
```

三处 `<TodoRow ...>` 都加 `:project-title="projectTitles.get(t.id)"`。

`TodoRow.vue`：props 加 `projectTitle?: string`；模板标题处改为：

```html
      <div>
        <p>{{ todo.title }}</p>
        <p v-if="meta" class="todo-meta">{{ meta }}</p>
      </div>
```

script 加：

```ts
import { computed } from "vue";
import { localDate } from "@/dates";
import { todoMeta } from "@/todo-meta";

const meta = computed(() =>
  todoMeta({ priority: props.todo.priority, due: props.todo.due, project: props.projectTitle }, localDate()),
);
```

（`import { onUnmounted, ref, watch }` 改为 `import { computed, onUnmounted, ref, watch }`。）

- [ ] **Step 5: 跑测试 + 全量回归**

Run: `npx vitest run src/__tests__/parse-flow-app.test.ts src/__tests__/todo-row.test.ts && npm run test`
Expected: PASS（close-session-app.test.ts 走 tidy 路径，不经解析，应不受影响；若有干扰按其 mock 方式修正）

- [ ] **Step 6: Commit**

```bash
git add src/App.vue src/screens/TodoScreen.vue src/components/TodoRow.vue src/__tests__/parse-flow-app.test.ts src/__tests__/todo-row.test.ts
git commit -m "feat: 对话流接入解析层，确认后待办带 急/截止/项目 落库"
```

---

### Task 10 (P2): Context Builder 动态组装（近期事件按需注入）

**Files:**
- Modify: `src/agent/context.ts`、`src/agent/loop.ts`、`src/App.vue`
- Test: `src/__tests__/context.test.ts`（扩展）

**Interfaces:**
- Consumes: `isChitchat`（parse.ts）、`normKey`、Task 2 `eventRepo.listRecent`
- Produces:
  - `matchedProjectKeys(result: ParseResult): string[]`（context.ts 导出）
  - `selectRelevantEvents(events: TimelineEvent[], result: ParseResult | null | undefined, today: string): TimelineEvent[]`（纯闲聊/无结果 → 空；否则取当天全部 + 文本包含相关项目名的近期事件，最多 10 条）
  - `buildContextMessages` / `runAgent` 输入再增 `parseResult?: ParseResult | null`、`recentEvents?: TimelineEvent[]`

- [ ] **Step 1: 写失败测试（追加到 context.test.ts）**

```ts
  it("纯闲聊不注入事件；关联项目时注入近期相关事件", () => {
    const base = {
      date: "2026-09-06",
      timeLabel: "上午 10:00",
      mode: "chat" as const,
      todayTodos: [],
      laterTodos: [],
      doneToday: [],
      messages: [],
      planConfirmed: false,
    };
    const events: TimelineEvent[] = [
      { id: "e1", date: "2026-09-05", createdAt: "2026-09-05T01:00:00.000Z", kind: "event", text: "朝暮解析层联调完了", fromMessageId: "m1" },
      { id: "e2", date: "2026-09-05", createdAt: "2026-09-05T02:00:00.000Z", kind: "event", text: "中午吃了螺蛳粉", fromMessageId: "m2" },
      { id: "e3", date: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", kind: "decision", text: "定了用 Postgres", fromMessageId: "m3" },
    ];
    const chitchat = buildContextMessages({ ...base, parseResult: null, recentEvents: events });
    expect(chitchat[0].content).not.toContain("近期相关记录");

    const withResult = buildContextMessages({
      ...base,
      parseResult: { ...emptyParseResult(), projectUpdates: [{ project: "朝暮", note: "x" }] },
      recentEvents: events,
    });
    const facts = withResult[0].content as string;
    expect(facts).toContain("近期相关记录");
    expect(facts).toContain("朝暮解析层联调完了");
    expect(facts).toContain("定了：定了用 Postgres");
    expect(facts).not.toContain("螺蛳粉");
  });
```

（import `emptyParseResult` from "@/agent/parse"、`TimelineEvent` 类型。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/context.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

context.ts 追加（import `normKey`、`isChitchat`、`ParseResult`、`TimelineEvent`）：

```ts
export function matchedProjectKeys(result: ParseResult): string[] {
  const keys = new Set<string>();
  for (const u of result.projectUpdates) keys.add(normKey(u.project));
  for (const t of result.tasks) if (t.project) keys.add(normKey(t.project));
  return [...keys];
}

/** 按需取事件：纯闲聊不取；否则取当天全部 + 文本命中相关项目的近期事件，最多 10 条。 */
export function selectRelevantEvents(
  events: TimelineEvent[],
  result: ParseResult | null | undefined,
  today: string,
): TimelineEvent[] {
  if (!result || isChitchat(result)) return [];
  const keys = matchedProjectKeys(result);
  const picked = events.filter((e) => e.date === today || keys.some((k) => normKey(e.text).includes(k)));
  return picked.slice(-10);
}

function formatEvents(events: TimelineEvent[]): string {
  if (events.length === 0) return "";
  return `近期相关记录 ${events.length} 条：${events.map((e) => (e.kind === "decision" ? `定了：${e.text}` : e.text)).join("；")}。`;
}
```

`buildContextMessages` 输入加 `parseResult?: ParseResult | null; recentEvents?: TimelineEvent[];`，facts 数组在 `formatMemories(...)` 后加一行：

```ts
    formatEvents(selectRelevantEvents(input.recentEvents ?? [], input.parseResult, input.date)),
```

`runAgent` 输入加同名字段并透传；App.vue 的 runTurn：把 `parseResult` 从 `if (userMsg)` 块内提到 `let parseResult: ParseResult | null = null;`（非 silent 轮赋值；App.vue 顶部 import 加 `type ParseResult`），runAgent 调用加 `parseResult`、`recentEvents: await eventRepo.listRecent(3)`。

- [ ] **Step 4: 跑测试 + 回归**

Run: `npm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/context.ts src/agent/loop.ts src/App.vue src/__tests__/context.test.ts
git commit -m "feat: 上下文按本轮解析动态注入近期相关事件"
```

---

### Task 11 (P2): 设置页长期记忆管理

**Files:**
- Modify: `src/screens/SettingsScreen.vue`、`src/App.vue`
- Test: `src/__tests__/settings-screen.test.ts`（新建）

**Interfaces:**
- Produces: `SettingsScreen` props 加 `memories?: Memory[]`；emit 加 `removeMemory: [id: string]`

- [ ] **Step 1: 写失败测试** `src/__tests__/settings-screen.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsScreen from "@/screens/SettingsScreen.vue";
import type { Memory, Settings } from "@/types";

const settings: Settings = { apiKey: "", model: "deepseek-v4-flash", debugOverlay: false, daySplitHour: 12 };
const memories: Memory[] = [
  { id: "m1", text: "早上不开会", kind: "preference", createdAt: "2026-09-06T01:00:00.000Z" },
  { id: "m2", text: "今年写完初稿", kind: "goal", createdAt: "2026-09-06T02:00:00.000Z" },
];

describe("SettingsScreen 长期记忆", () => {
  it("列出记忆（含类别标签），点删除发出 removeMemory", async () => {
    const w = mount(SettingsScreen, { props: { settings, memories } });
    expect(w.text()).toContain("长期记忆");
    expect(w.text()).toContain("偏好");
    expect(w.text()).toContain("早上不开会");
    expect(w.text()).toContain("目标");
    const delButtons = w.findAll("[data-memory-del]");
    expect(delButtons).toHaveLength(2);
    await delButtons[0].trigger("click");
    expect(w.emitted("removeMemory")?.[0]).toEqual(["m1"]);
  });

  it("没有记忆时不渲染该区块", () => {
    const w = mount(SettingsScreen, { props: { settings, memories: [] } });
    expect(w.text()).not.toContain("长期记忆");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/settings-screen.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 SettingsScreen.vue 改动**

模板在「朝暮分界」label 之后、「保存」按钮之前插入：

```html
      <div v-if="memories && memories.length > 0" class="field">
        <span>长期记忆</span>
        <p class="hint">对话里确认过的稳定偏好、长期目标、持续关注。删错了没关系，下次聊到还会再问你。</p>
        <div v-for="m in memories" :key="m.id" class="memory-row">
          <span class="todo-meta">{{ MEMORY_KIND_LABEL[m.kind] }}</span>
          <span class="memory-text">{{ m.text }}</span>
          <button type="button" :data-memory-del="m.id" @click="emit('removeMemory', m.id)">删除</button>
        </div>
      </div>
```

script：

```ts
import { MEMORY_KIND_LABEL, type Memory, type Settings } from "@/types";

const props = defineProps<{ settings: Settings; memories?: Memory[] }>();
const emit = defineEmits<{ save: [settings: Settings]; removeMemory: [id: string] }>();
```

（`memories` 在模板直接用 `props` 同名；script setup 中 props 解构外的 `memories` 引用改为 computed 或直接用 `props.memories`——模板里可直接写 `memories`，script setup 的 defineProps 声明后模板可见。）

styles.css 追加：

```css
.memory-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.memory-text {
  flex: 1;
}
```

App.vue：SettingsScreen 标签加 `@remove-memory="onRemoveMemory"`；加：

```ts
async function onRemoveMemory(id: string) {
  await ready;
  await memoryRepo.remove(id);
  memories.value = await memoryRepo.list();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/__tests__/settings-screen.test.ts && npm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/SettingsScreen.vue src/App.vue src/styles.css src/__tests__/settings-screen.test.ts
git commit -m "feat: 设置页可查看、删除长期记忆"
```

---

### Task 12 (P2): 语料 eval（真实 API，人工运行）

**Files:**
- Create: `src/agent/parse-eval.ts`、`vitest.eval.config.ts`、`eval/parse.eval.test.ts`
- Modify: `package.json`
- Test: `src/__tests__/parse-eval.test.ts`

**Interfaces:**
- Produces: `scoreCase(c: CorpusCase, r: ParseResult): { pass: boolean; misses: string[] }`；npm script `eval:parse`

- [ ] **Step 1: 写失败测试** `src/__tests__/parse-eval.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyParseResult } from "@/agent/parse";
import type { CorpusCase } from "@/agent/parse-corpus";
import { scoreCase } from "@/agent/parse-eval";

describe("scoreCase", () => {
  it("包含匹配：期望 task 命中即过", () => {
    const c: CorpusCase = { input: "x", expect: { tasks: ["交稿"] } };
    const r = { ...emptyParseResult(), tasks: [{ title: "明天下午三点前交稿" }] };
    expect(scoreCase(c, r).pass).toBe(true);
  });

  it("notTasks 命中即失败并给出原因", () => {
    const c: CorpusCase = { input: "x", expect: { notTasks: ["看海"] } };
    const r = { ...emptyParseResult(), tasks: [{ title: "去看海"] }] };
    const s = scoreCase(c, r);
    expect(s.pass).toBe(false);
    expect(s.misses.join()).toContain("误抽 task");
  });

  it("记忆类别不一致算失败", () => {
    const c: CorpusCase = { input: "x", expect: { memories: [{ text: "早上不开会", kind: "preference" }] } };
    const r = { ...emptyParseResult(), memories: [{ text: "我早上不开会", kind: "goal" }] };
    const s = scoreCase(c, r);
    expect(s.pass).toBe(false);
    expect(s.misses.join()).toContain("类型");
  });

  it("chitchat 期望下六类全空才过", () => {
    const c: CorpusCase = { input: "x", expect: { chitchat: true } };
    expect(scoreCase(c, emptyParseResult()).pass).toBe(true);
    expect(scoreCase(c, { ...emptyParseResult(), events: ["有事"] }).pass).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/parse-eval.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `src/agent/parse-eval.ts`**

```ts
import { normKey } from "@/norm";
import { isChitchat } from "./parse";
import type { CorpusCase } from "./parse-corpus";
import type { ParseResult } from "@/types";

export interface ScoreResult {
  pass: boolean;
  misses: string[];
}

function hit(haystack: string[], needle: string): boolean {
  const n = normKey(needle);
  return haystack.some((h) => h.includes(n) || n.includes(h));
}

/** 用语料期望给真实解析结果打分。所有匹配都是归一化后的双向包含。 */
export function scoreCase(c: CorpusCase, r: ParseResult): ScoreResult {
  const misses: string[] = [];
  const taskTitles = r.tasks.map((t) => normKey(t.title));
  const eventTexts = r.events.map(normKey);
  const decisionTexts = r.decisions.map(normKey);
  const waitingTexts = r.waitings.map((w) => normKey(w.text));
  const memoryTexts = r.memories.map((m) => normKey(m.text));

  for (const t of c.expect.tasks ?? []) if (!hit(taskTitles, t)) misses.push(`缺 task:${t}`);
  for (const t of c.expect.notTasks ?? []) if (hit(taskTitles, t)) misses.push(`误抽 task:${t}`);
  for (const e of c.expect.events ?? []) if (!hit(eventTexts, e)) misses.push(`缺 event:${e}`);
  for (const d of c.expect.decisions ?? []) if (!hit(decisionTexts, d)) misses.push(`缺 decision:${d}`);
  for (const w of c.expect.waitings ?? []) if (!hit(waitingTexts, w)) misses.push(`缺 waiting:${w}`);
  for (const m of c.expect.memories ?? []) {
    const found = r.memories.find((x) => {
      const xk = normKey(x.text);
      const mk = normKey(m.text);
      return xk.includes(mk) || mk.includes(xk);
    });
    if (!found) misses.push(`缺 memory:${m.text}`);
    else if (found.kind !== m.kind) misses.push(`memory 类型错:${m.text} ${found.kind}≠${m.kind}`);
  }
  for (const m of c.expect.notMemories ?? []) if (hit(memoryTexts, m)) misses.push(`误记 memory:${m}`);
  if (c.expect.chitchat && !isChitchat(r)) misses.push("应为纯闲聊");
  return { pass: misses.length === 0, misses };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/__tests__/parse-eval.test.ts`
Expected: PASS

- [ ] **Step 5: eval 配置与入口**

`vitest.eval.config.ts`：

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["eval/**/*.test.ts"],
    testTimeout: 300_000,
  },
});
```

`eval/parse.eval.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { chatCompletions } from "@/api/deepseek";
import { parseInput } from "@/agent/parse";
import { PARSE_CORPUS } from "@/agent/parse-corpus";
import { scoreCase } from "@/agent/parse-eval";

const key = process.env.DEEPSEEK_API_KEY ?? "";
const model = process.env.ZHAOMU_EVAL_MODEL ?? "deepseek-v4-flash";

const postJson = async (url: string, headers: Record<string, string>, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as unknown };
};

describe.skipIf(!key)("解析语料 eval（真实 API，需 DEEPSEEK_API_KEY 环境变量）", () => {
  it("逐条打分并报告通过率", async () => {
    let pass = 0;
    for (const c of PARSE_CORPUS) {
      const result = await parseInput({
        text: c.input,
        date: "2026-09-06",
        todos: [],
        projects: [],
        model,
        complete: (req) => chatCompletions({ apiKey: key, request: req, postJson }),
      });
      const score = scoreCase(c, result);
      if (score.pass) {
        pass += 1;
      } else {
        console.log(`✗ ${c.input}\n  ${score.misses.join("；")}`);
      }
    }
    const rate = pass / PARSE_CORPUS.length;
    console.log(`通过率 ${pass}/${PARSE_CORPUS.length} = ${(rate * 100).toFixed(0)}%`);
    expect(rate).toBeGreaterThanOrEqual(0.7);
  });
});
```

package.json scripts 加：

```json
    "eval:parse": "vitest run --config vitest.eval.config.ts"
```

验证默认测试不含 eval：`npm run test` 用 `vitest.config.ts`，其未配置 `include`，vitest 默认 include 是 `**/*.{test,spec}.?(c|m)[jt]s?(x)`——会命中 `eval/parse.eval.test.ts`！**必须在 `vitest.config.ts` 里显式限制**：

```ts
  test: {
    environment: "happy-dom",
    setupFiles: ["src/__tests__/setup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["node_modules", "dist", "android"],
  },
```

（这一步必须做，否则 eval 会进日常测试。）

- [ ] **Step 6: 验证**

Run: `npm run test`（确认 eval 不被执行）&& `npx vitest run --config vitest.eval.config.ts`（无 key 时整体 skip 且退出码 0）
Expected: 两者都通过

- [ ] **Step 7: Commit**

```bash
git add src/agent/parse-eval.ts src/__tests__/parse-eval.test.ts vitest.eval.config.ts vitest.config.ts eval/parse.eval.test.ts package.json
git commit -m "feat: 解析语料 eval（真实 API 人工运行，npm run eval:parse）"
```

---

### Task 13: AGENTS.md 同步 + 最终验证

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新 AGENTS.md**

- 「代码组织」的 `src/agent/` 段加：`parse.ts`（输入解析：结构化抽取 + 判定规则提示词）、`route-parse.ts`（解析产出路由）、`parse-corpus.ts`（判断语料）、`parse-eval.ts`（语料打分）；顶层模块加 `norm`、`todo-meta`；storage/db.ts 行改为四个仓储 + 四个新仓储的说明；加一行 `eval/ 语料 eval（真实 API，人工运行，不进 npm test）`。
- 「关键架构规则」把「Agent 永远不直接写待办」一条改写为：抽取由解析层负责（每条非 silent 输入先过 `parseInput`），待办与长期记忆都必须经确认框落库；loop 工具只有 `list_todos` / `set_today_plan`；加一条三层数据规则（Timeline=chats+events，State=todos+projects+waitings，Memory=memories，确认边界）和 DB v2 说明。
- 「构建与测试命令」加 `npm run eval:parse`（人工、需 `DEEPSEEK_API_KEY` 环境变量）。
- 「测试」段的基线数字更新为实际值（跑完 `npm run test` 后填）。

- [ ] **Step 2: 全量验证**

Run: `npm run test && npm run build`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 同步结构化记忆架构"
```

---

## 明确不做（本次范围外）

- 日记生成读 events 增强（spec §P2 提及，留待下一步单独设计）。
- 待办页编辑 priority/due/project 的 UI（本期只展示）。
- Project/Waiting 的独立界面（只进上下文与待办页徽标）。
