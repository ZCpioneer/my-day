# 自动整理只刷新待办、日记自己收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动整理只根据当前会话刷新今日待办（确认后才写）；日记改由日记页按钮生成，隔夜打开再补最近一篇缺的日记，不再问。

**Architecture:** 待办仍走对话里的 `runAgent` + `set_today_plan` / `propose_todos` 确认框。日记另开 `composeDailyLog(date)`，不追加聊天、不弹确认。隔夜补写是纯函数 `pickCatchUpDate` + `catchUpDiary`，由 App 在启动、回前台、开着跨日时调用。

**Tech Stack:** Vue 3.5、Vite 6、TypeScript、Vitest、fake-indexeddb、@vue/test-utils、happy-dom、Capacitor 7、DeepSeek Chat Completions。

## Global Constraints

- 待办必须在对话确认框里点了才写入；Agent 不能勾掉任务，不能在对话里直接写库。
- 日记页「整理成日记」点一下就是同意；隔夜补写直接 `logRepo.put`，不再问。
- 自动整理不写日记；对话工具列表不再包含 `write_daily_log`。
- 过夜不改待办的 `when`。只打卡、从不整理的人，今天那几件继续留着。
- 隔夜补写不靠系统后台：冷启动、回前台、App 开着约每分钟看一次本地日期。
- 从昨天往前最多 14 天，只补「有痕迹、无日记」里最近的一篇。
- 没 Key 或请求失败：跳过补写，不挡第一屏。
- 日记页仍只展示今天。补上的那篇在 IndexedDB，当前页看不到。
- 界面中文；视觉跟现有墨底、灯暖金、暮蓝。
- 单机安卓，IndexedDB 库名 `zhaomu`。
- 一轮对话最多 4 次模型调用。自动整理位置仍是发送左边。

---

## File Structure

```
src/dates.ts                         # 增加 shiftLocalDate
src/todos.ts                         # 增加 snapshotLogTitles（日记做成了/没做完）
src/diary.ts                         # hasDiaryTraces、pickCatchUpDate、catchUpDiary
src/agent/prompt.ts                  # 自动整理只整理待办；增加 diaryPrompt
src/agent/compose-log.ts             # composeDailyLog
src/agent/tools.ts                   # 拿掉 write_daily_log
src/agent/loop.ts                    # 拿掉写日记工具与 onConfirmLog
src/agent/context.ts                 # 模式文案；planConfirmed 不再用 evening
src/screens/ChatScreen.vue           # 空状态；拿掉日记确认框
src/screens/DiaryScreen.vue          # 「整理成日记」按钮
src/screens/SettingsScreen.vue       # 朝暮分界说明
src/App.vue                          # tidy 不再切暮；日记按钮；补写触发
src/styles.css                       # 日记按钮、补写提示
demo/index.html                      # 示意跟产品一致
src/__tests__/dates.test.ts
src/__tests__/todos.test.ts
src/__tests__/diary.test.ts
src/__tests__/compose-log.test.ts
src/__tests__/loop.test.ts
src/__tests__/diary-screen.test.ts
src/__tests__/ritual.test.ts
```

职责：`diary.ts` 只决定补哪一天、要不要写，不打模型。`compose-log.ts` 只生成一篇 `DailyLog`。`loop.ts` 只管对话待办。`App.vue` 把三件事接上（整理、按钮、补写），自己不写挑选逻辑。

---

### Task 1: 日期平移与补写选日

**Files:**
- Modify: `src/dates.ts`
- Create: `src/diary.ts`
- Modify: `src/__tests__/dates.test.ts`
- Create: `src/__tests__/diary.test.ts`

**Interfaces:**
- Consumes: `localDate` in `src/dates.ts`; `DayChat`, `Todo` in `src/types.ts`; `isDoneOn` in `src/todos.ts`
- Produces:
  - `shiftLocalDate(iso: string, days: number): string`
  - `CATCH_UP_LOOKBACK_DAYS = 14`
  - `hasDiaryTraces(input: { chat: DayChat; todos: Todo[]; date: string }): boolean`
  - `pickCatchUpDate(input: { today: string; lookBackDays?: number; hasLog: (date: string) => Promise<boolean>; hasTraces: (date: string) => Promise<boolean> }): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/dates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { localDate, shiftLocalDate } from "@/dates";

describe("localDate", () => {
  it("formats the local calendar day", () => {
    const d = new Date(2026, 8, 5, 23, 30, 0);
    expect(localDate(d)).toBe("2026-09-05");
  });
});

describe("shiftLocalDate", () => {
  it("moves by whole local calendar days and crosses months", () => {
    expect(shiftLocalDate("2026-09-05", -1)).toBe("2026-09-04");
    expect(shiftLocalDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftLocalDate("2026-09-05", 0)).toBe("2026-09-05");
  });
});
```

Create `src/__tests__/diary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CATCH_UP_LOOKBACK_DAYS, hasDiaryTraces, pickCatchUpDate } from "@/diary";
import type { DayChat, Todo } from "@/types";

function chat(over: Partial<DayChat> & Pick<DayChat, "date">): DayChat {
  return { messages: [], ...over };
}

describe("hasDiaryTraces", () => {
  it("is true when that day has messages, a confirmed plan, or a completion", () => {
    expect(hasDiaryTraces({ chat: chat({ date: "2026-09-04" }), todos: [], date: "2026-09-04" })).toBe(false);
    expect(
      hasDiaryTraces({
        chat: chat({
          date: "2026-09-04",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "hi",
              createdAt: "2026-09-04T01:00:00.000Z",
            },
          ],
        }),
        todos: [],
        date: "2026-09-04",
      }),
    ).toBe(true);
    expect(
      hasDiaryTraces({
        chat: chat({ date: "2026-09-04", planConfirmedAt: "2026-09-04T02:00:00.000Z" }),
        todos: [],
        date: "2026-09-04",
      }),
    ).toBe(true);
    const done: Todo = {
      id: "t1",
      title: "支付宝",
      status: "done",
      sourceDate: "2026-09-04",
      createdAt: "2026-09-04T01:00:00.000Z",
      completedAt: "2026-09-04T12:00:00.000Z",
      when: "today",
    };
    expect(hasDiaryTraces({ chat: chat({ date: "2026-09-04" }), todos: [done], date: "2026-09-04" })).toBe(true);
    expect(hasDiaryTraces({ chat: chat({ date: "2026-09-05" }), todos: [done], date: "2026-09-05" })).toBe(false);
  });
});

describe("pickCatchUpDate", () => {
  it("picks the most recent date with traces and no log, within 14 days", async () => {
    expect(CATCH_UP_LOOKBACK_DAYS).toBe(14);
    const logs = new Set(["2026-09-05"]);
    const traces = new Set(["2026-09-04", "2026-09-02"]);
    const picked = await pickCatchUpDate({
      today: "2026-09-05",
      hasLog: async (d) => logs.has(d),
      hasTraces: async (d) => traces.has(d),
    });
    expect(picked).toBe("2026-09-04");
  });

  it("skips yesterday when it has a log and takes the next traced gap", async () => {
    const logs = new Set(["2026-09-04"]);
    const traces = new Set(["2026-09-04", "2026-09-02"]);
    const picked = await pickCatchUpDate({
      today: "2026-09-05",
      hasLog: async (d) => logs.has(d),
      hasTraces: async (d) => traces.has(d),
    });
    expect(picked).toBe("2026-09-02");
  });

  it("returns null when nothing in the window qualifies", async () => {
    const picked = await pickCatchUpDate({
      today: "2026-09-05",
      hasLog: async () => false,
      hasTraces: async () => false,
    });
    expect(picked).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/dates.test.ts src/__tests__/diary.test.ts`

Expected: FAIL, `shiftLocalDate` / `@/diary` is not exported.

- [ ] **Step 3: Implement**

`src/dates.ts` 全文：

```ts
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftLocalDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return localDate(dt);
}
```

Create `src/diary.ts`:

```ts
import { shiftLocalDate } from "./dates";
import { isDoneOn } from "./todos";
import type { DayChat, DailyLog, Todo } from "./types";

export const CATCH_UP_LOOKBACK_DAYS = 14;

export function hasDiaryTraces(input: { chat: DayChat; todos: Todo[]; date: string }): boolean {
  if (input.chat.planConfirmedAt) return true;
  if (input.chat.messages.length > 0) return true;
  return input.todos.some((t) => isDoneOn(t, input.date));
}

export async function pickCatchUpDate(input: {
  today: string;
  lookBackDays?: number;
  hasLog: (date: string) => Promise<boolean>;
  hasTraces: (date: string) => Promise<boolean>;
}): Promise<string | null> {
  const n = input.lookBackDays ?? CATCH_UP_LOOKBACK_DAYS;
  for (let i = 1; i <= n; i++) {
    const date = shiftLocalDate(input.today, -i);
    if (await input.hasLog(date)) continue;
    if (await input.hasTraces(date)) return date;
  }
  return null;
}

export async function catchUpDiary(_input: {
  today: string;
  hasKey: boolean;
  getChat: (date: string) => Promise<DayChat>;
  listTodos: () => Promise<Todo[]>;
  getLog: (date: string) => Promise<DailyLog | null>;
  putLog: (log: DailyLog) => Promise<void>;
  compose: (date: string) => Promise<DailyLog>;
}): Promise<string | null> {
  return null;
}
```

`catchUpDiary` 先占位返回 `null`，Task 4 再写测试并实现。本任务不要在 `diary.test.ts` 里测它。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/dates.test.ts src/__tests__/diary.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dates.ts src/diary.ts src/__tests__/dates.test.ts src/__tests__/diary.test.ts
git commit -m "$(cat <<'EOF'
feat: pick the most recent missing diary day

EOF
)"
```

---

### Task 2: composeDailyLog

**Files:**
- Modify: `src/todos.ts`
- Modify: `src/agent/prompt.ts`
- Create: `src/agent/compose-log.ts`
- Modify: `src/__tests__/todos.test.ts`
- Create: `src/__tests__/compose-log.test.ts`

**Interfaces:**
- Consumes: `partitionTodos`, `todoWhen` from `src/todos.ts`; `ChatCompletionRequest` / `ChatCompletionResponse` from `src/api/deepseek.ts`; `DayChat`, `DailyLog`, `Todo`
- Produces:
  - `snapshotLogTitles(todos: Todo[], date: string): { done: string[]; undone: string[] }`
  - `diaryPrompt(): string`
  - `composeDailyLog(input: { date: string; now: Date; chat: DayChat; todos: Todo[]; complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>; model: string }): Promise<DailyLog>`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/todos.test.ts`（已有 `todo()` helper，直接加 describe）：

```ts
import { applyTodayPlan, partitionTodos, snapshotLogTitles, todoWhen } from "@/todos";

describe("snapshotLogTitles", () => {
  it("uses today's plan only; later checkoffs are not 做成了", () => {
    const rows: Todo[] = [
      todo({ id: "a", title: "支付宝", when: "today" }),
      todo({
        id: "b",
        title: "水电",
        when: "today",
        status: "done",
        completedAt: "2026-09-05T04:00:00.000Z",
      }),
      todo({
        id: "c",
        title: "周报",
        when: "later",
        status: "done",
        completedAt: "2026-09-05T05:00:00.000Z",
      }),
    ];
    expect(snapshotLogTitles(rows, "2026-09-05")).toEqual({
      done: ["水电"],
      undone: ["支付宝"],
    });
  });
});
```

Create `src/__tests__/compose-log.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { composeDailyLog } from "@/agent/compose-log";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import type { Todo } from "@/types";

describe("composeDailyLog", () => {
  const todos: Todo[] = [
    {
      id: "1",
      title: "周报",
      status: "open",
      sourceDate: "2026-09-04",
      createdAt: "2026-09-04T01:00:00.000Z",
      when: "today",
    },
    {
      id: "2",
      title: "支付宝",
      status: "done",
      sourceDate: "2026-09-04",
      createdAt: "2026-09-04T01:00:00.000Z",
      completedAt: "2026-09-04T12:00:00.000Z",
      when: "today",
    },
  ];

  it("fills plan/state from the model and done/undone from todos for that date", async () => {
    const log = await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: {
        date: "2026-09-04",
        messages: [
          {
            id: "m1",
            role: "user",
            content: "先做支付宝",
            createdAt: "2026-09-04T01:00:00.000Z",
          },
        ],
        planConfirmedAt: "2026-09-04T02:00:00.000Z",
      },
      todos,
      model: "deepseek-v4-flash",
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        expect(req.tools).toEqual([]);
        expect(JSON.stringify(req.messages)).toContain("先做支付宝");
        return { content: '{"plan":"先做支付宝","state":"有点累"}', tool_calls: [] };
      },
    });
    expect(log.date).toBe("2026-09-04");
    expect(log.plan).toBe("先做支付宝");
    expect(log.state).toBe("有点累");
    expect(log.done).toEqual(["支付宝"]);
    expect(log.undone).toEqual(["周报"]);
  });

  it("reads JSON even when wrapped in a fence", async () => {
    const log = await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: { date: "2026-09-04", messages: [] },
      todos,
      model: "deepseek-v4-flash",
      complete: async () => ({
        content: "```json\n{\"plan\":\"没有确认过今日计划\",\"state\":\"只勾了几件\"}\n```",
        tool_calls: [],
      }),
    });
    expect(log.plan).toBe("没有确认过今日计划");
    expect(log.state).toBe("只勾了几件");
  });

  it("throws when the model returns unusable content", async () => {
    await expect(
      composeDailyLog({
        date: "2026-09-04",
        now: new Date(2026, 8, 5, 8, 0, 0),
        chat: { date: "2026-09-04", messages: [] },
        todos,
        model: "deepseek-v4-flash",
        complete: async () => ({ content: "写不出来", tool_calls: [] }),
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/todos.test.ts src/__tests__/compose-log.test.ts`

Expected: FAIL, `snapshotLogTitles` / `composeDailyLog` 不存在。

- [ ] **Step 3: Implement**

Append to `src/todos.ts`:

```ts
export function snapshotLogTitles(todos: Todo[], date: string): { done: string[]; undone: string[] } {
  const { today, doneToday } = partitionTodos(todos, date);
  return {
    undone: today.map((t) => t.title),
    done: doneToday.filter((t) => todoWhen(t) === "today").map((t) => t.title),
  };
}
```

Append to `src/agent/prompt.ts`（保留现有 `systemPrompt`，本任务先只加 `diaryPrompt`；`systemPrompt` 正文改在 Task 3）：

```ts
export function diaryPrompt(): string {
  return `你给「朝暮」写一篇当天日记。只输出一个 JSON 对象，不要 markdown，不要其它字。
字段：
- plan: string 当天打算做什么。没确认过计划就写明没有确认过，可补一句从对话里看到的安排。
- state: string 当天状态，一两句。
不要编造勾选。做成了、没做完由系统按待办填写。`;
}
```

Create `src/agent/compose-log.ts`:

```ts
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { snapshotLogTitles } from "@/todos";
import type { ChatMessage, DailyLog, DayChat, Todo } from "@/types";
import { diaryPrompt } from "./prompt";

function parseJsonObject(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(body);
  if (direct && typeof direct === "object") return direct;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(body.slice(start, end + 1));
  return undefined;
}

function transcript(messages: ChatMessage[]): string {
  if (messages.length === 0) return "（当天没有对话）";
  return messages
    .map((m) => `${m.role === "user" ? "我" : "朝暮"}：${m.content}`)
    .join("\n");
}

export async function composeDailyLog(input: {
  date: string;
  now: Date;
  chat: DayChat;
  todos: Todo[];
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
  model: string;
}): Promise<DailyLog> {
  const snap = snapshotLogTitles(input.todos, input.date);
  const facts = [
    `日期：${input.date}`,
    input.chat.planConfirmedAt ? "当天确认过今日计划。" : "当天没有确认过今日计划。",
    `做成了：${snap.done.length ? snap.done.join("；") : "无"}`,
    `没做完：${snap.undone.length ? snap.undone.join("；") : "无"}`,
    "对话：",
    transcript(input.chat.messages),
  ].join("\n");

  const res = await input.complete({
    model: input.model,
    messages: [
      { role: "system", content: diaryPrompt() },
      { role: "user", content: facts },
    ],
    tools: [],
    stream: false,
  });
  const parsed = typeof res.content === "string" ? parseJsonObject(res.content) : undefined;
  if (!parsed || typeof parsed !== "object") throw new Error("日记这轮没写成");
  const plan = (parsed as { plan?: unknown }).plan;
  const state = (parsed as { state?: unknown }).state;
  if (typeof plan !== "string" || typeof state !== "string") throw new Error("日记这轮没写成");

  return {
    date: input.date,
    plan,
    done: snap.done,
    undone: snap.undone,
    state,
    updatedAt: input.now.toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/todos.test.ts src/__tests__/compose-log.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/todos.ts src/agent/prompt.ts src/agent/compose-log.ts src/__tests__/todos.test.ts src/__tests__/compose-log.test.ts
git commit -m "$(cat <<'EOF'
feat: compose a daily log from chat and todo snapshot

EOF
)"
```

---

### Task 3: 对话路径不再写日记

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `src/agent/loop.ts`
- Modify: `src/agent/prompt.ts`
- Modify: `src/agent/context.ts`
- Modify: `src/__tests__/loop.test.ts`
- Modify: `src/__tests__/ritual-time.test.ts`

**Interfaces:**
- Consumes: `runAgent` 现有签名；Task 2 的 `snapshotLogTitles` 可选用，本任务从 loop 里删掉日记快照
- Produces:
  - `TOOL_DEFS` 只含 `list_todos`、`propose_todos`、`set_today_plan`、`suggest_order`
  - `AgentDeps` 不再有 `writeDailyLog`、`onConfirmLog`
  - `runAgent(input: { deps: AgentDeps; mode: ChatMode; userText: string; history: ChatMessage[]; model: string; planConfirmed?: boolean })`
  - `systemPrompt()` 禁止写日记；自动整理一律用 `set_today_plan`
  - `buildContextMessages` 的 `modeLabel`：`morning` / `evening` 都是「整理今日待办」，`chat` 是「闲聊」

- [ ] **Step 1: Write the failing tests**

把 `src/__tests__/loop.test.ts` 里 `deps()` 的 `writeDailyLog`、`onConfirmLog` 删掉。删掉这两个用例：

- `write_daily_log persists one full document`
- `does not write the diary when the user skips confirm`

换成：

```ts
it("does not persist a diary when the model names write_daily_log", async () => {
  const saved: DailyLog[] = [];
  const d = deps({
    complete: async (): Promise<ChatCompletionResponse> => ({
      content: null,
      tool_calls: [
        {
          id: "w",
          type: "function",
          function: {
            name: "write_daily_log",
            arguments: JSON.stringify({
              plan: "先调试",
              done: [],
              undone: [],
              state: "还行",
            }),
          },
        },
      ],
    }),
  });
  const r = await runAgent({
    deps: d,
    mode: "evening",
    userText: "自动整理。",
    history: [],
    model: "deepseek-v4-flash",
    planConfirmed: true,
  });
  expect(saved).toEqual([]);
  expect(r.stopped).toBe(true);
});
```

`set_today_plan waits for confirm...` 保持，并加一条：已确认过计划仍走 `set_today_plan`：

```ts
it("set_today_plan still runs after a plan was already confirmed", async () => {
  const planned: string[] = [];
  let calls = 0;
  const d = deps({
    complete: async (): Promise<ChatCompletionResponse> => {
      calls += 1;
      if (calls === 1) {
        return {
          content: null,
          tool_calls: [
            {
              id: "s",
              type: "function",
              function: {
                name: "set_today_plan",
                arguments: JSON.stringify({ items: [{ title: "支付宝" }] }),
              },
            },
          ],
        };
      }
      return { content: "今日计划刷新了。", tool_calls: [] };
    },
    setTodayPlan: async (items) => {
      planned.push(...items.map((i) => i.title));
    },
  });
  await runAgent({
    deps: d,
    mode: "morning",
    userText: "自动整理。",
    history: [],
    model: "deepseek-v4-flash",
    planConfirmed: true,
  });
  expect(planned).toEqual(["支付宝"]);
});
```

`src/__tests__/ritual-time.test.ts` 的 `buildContextMessages` 用例里，把期望改成包含「整理今日待办」，不要再要求「暮（结束今天）」：

```ts
expect(blob).toContain("整理今日待办");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/loop.test.ts src/__tests__/ritual-time.test.ts`

Expected: FAIL。`write_daily_log` 仍会写库或 `stopped` 不为 true；上下文仍是「暮（结束今天）」。`deps()` 若已删字段，现有 loop 实现会因类型/运行缺字段失败，也算预期红灯。

- [ ] **Step 3: Implement**

`src/agent/tools.ts`：删除整个 `write_daily_log` 那一项，文件以 `suggest_order` 结束。

`src/agent/loop.ts`：

- `AgentDeps` 删掉 `writeDailyLog`、`onConfirmLog`
- 删掉 `executeTool` 里整个 `write_daily_log` 分支
- 删掉 `snapshotTodoTitles`（改由 `todos.ts` 的 `snapshotLogTitles` 服务日记）
- `runAgent` 增加 `planConfirmed?: boolean`，传给 `buildContextMessages`：

```ts
planConfirmed: input.planConfirmed ?? false,
```

不要再用 `mode === "evening"`。

`src/agent/prompt.ts` 的 `systemPrompt` 改成：

```ts
export function systemPrompt(): string {
  return `你是「朝暮」，只做一件事：把用户今天的事情整理进待办。你不是陪聊、不是人生教练、不要闲扯。

规则：
- 每次只问一个问题，短。问完就停，等用户说。
- 不要声称已经写入待办或日记。只能提议，等用户在确认框里点。
- 完成情况只看待办列表。用户勾掉的才是已完成。
- 待办分三层：今天（打算今天做）、以后（先记着）、今日已完成。以后不算没做完。
- 一天塞不了太多。定今天的清单时只挑最要紧的几件，剩下的留在以后。
- 不要写日记。日记在日记页，用户会自己点「整理成日记」。
- 自动整理：先报今天和以后各有哪些，建议今天做哪几件、有没有漏的，再用 set_today_plan 让用户确认。没选上的今天事项会掉回以后。新冒出来、今天不做的用 propose_todos 记到以后。已经定过计划再整理，就是刷新今天这几件，不是去写日记。
- 白天随口说的可执行任务，用 propose_todos 记到以后，不要用 set_today_plan。用户明确说「改成今天做这些」才再 set_today_plan。`;
}
```

保留 Task 2 加的 `diaryPrompt`。

`src/agent/context.ts` 的 `modeLabel`：

```ts
function modeLabel(mode: ChatMode): string {
  if (mode === "chat") return "闲聊";
  return "整理今日待办";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/loop.test.ts src/__tests__/ritual-time.test.ts`

Expected: PASS。`write_daily_log` 变成未知工具，loop 在 MAX_MODEL_CALLS 后 `stopped: true`，不写日记。

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts src/agent/loop.ts src/agent/prompt.ts src/agent/context.ts src/__tests__/loop.test.ts src/__tests__/ritual-time.test.ts
git commit -m "$(cat <<'EOF'
feat: stop writing the diary from chat tools

EOF
)"
```

---

### Task 4: catchUpDiary 编排

**Files:**
- Modify: `src/diary.ts`
- Modify: `src/__tests__/diary.test.ts`

**Interfaces:**
- Consumes: `hasDiaryTraces`、`pickCatchUpDate`（Task 1）；`composeDailyLog` 的函数类型（本任务只通过 `compose` 回调调用，不 import `compose-log.ts`）
- Produces:
  - `catchUpDiary(input: { today: string; hasKey: boolean; getChat: (date: string) => Promise<DayChat>; listTodos: () => Promise<Todo[]>; getLog: (date: string) => Promise<DailyLog | null>; putLog: (log: DailyLog) => Promise<void>; compose: (date: string) => Promise<DailyLog> }): Promise<string | null>`
  - 返回写入的日期，或 `null`（没 Key / 没候选 / compose 失败）
  - 成功才 `putLog`；失败不写；不改任何 Todo

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/diary.test.ts`：

```ts
import { CATCH_UP_LOOKBACK_DAYS, catchUpDiary, hasDiaryTraces, pickCatchUpDate } from "@/diary";
import type { DailyLog, DayChat, Todo } from "@/types";

describe("catchUpDiary", () => {
  const yesterdayChat: DayChat = {
    date: "2026-09-04",
    messages: [
      { id: "m1", role: "user", content: "hi", createdAt: "2026-09-04T01:00:00.000Z" },
    ],
  };
  const log: DailyLog = {
    date: "2026-09-04",
    plan: "先做支付宝",
    done: ["支付宝"],
    undone: ["周报"],
    state: "还行",
    updatedAt: "2026-09-05T00:01:00.000Z",
  };

  it("writes the picked day and does not touch todos", async () => {
    const logs = new Map<string, DailyLog>();
    const chats = new Map<string, DayChat>([["2026-09-04", yesterdayChat]]);
    const todos: Todo[] = [
      {
        id: "t1",
        title: "周报",
        status: "open",
        sourceDate: "2026-09-04",
        createdAt: "2026-09-04T01:00:00.000Z",
        when: "today",
      },
    ];
    const wrote = await catchUpDiary({
      today: "2026-09-05",
      hasKey: true,
      getChat: async (d) => chats.get(d) ?? { date: d, messages: [] },
      listTodos: async () => todos,
      getLog: async (d) => logs.get(d) ?? null,
      putLog: async (row) => {
        logs.set(row.date, row);
      },
      compose: async (d) => ({ ...log, date: d }),
    });
    expect(wrote).toBe("2026-09-04");
    expect(logs.get("2026-09-04")?.plan).toBe("先做支付宝");
    expect(todos[0].when).toBe("today");
    expect(todos[0].status).toBe("open");
  });

  it("skips when there is no key", async () => {
    let composed = 0;
    const wrote = await catchUpDiary({
      today: "2026-09-05",
      hasKey: false,
      getChat: async (d) => (d === "2026-09-04" ? yesterdayChat : { date: d, messages: [] }),
      listTodos: async () => [],
      getLog: async () => null,
      putLog: async () => {
        throw new Error("should not write");
      },
      compose: async () => {
        composed += 1;
        return log;
      },
    });
    expect(wrote).toBeNull();
    expect(composed).toBe(0);
  });

  it("does not overwrite an existing log", async () => {
    const logs = new Map<string, DailyLog>([["2026-09-04", { ...log, plan: "已经有了" }]]);
    let composed = 0;
    const wrote = await catchUpDiary({
      today: "2026-09-05",
      hasKey: true,
      getChat: async (d) => (d === "2026-09-04" ? yesterdayChat : { date: d, messages: [] }),
      listTodos: async () => [],
      getLog: async (d) => logs.get(d) ?? null,
      putLog: async (row) => {
        logs.set(row.date, row);
      },
      compose: async () => {
        composed += 1;
        return { ...log, plan: "新的" };
      },
    });
    expect(wrote).toBeNull();
    expect(composed).toBe(0);
    expect(logs.get("2026-09-04")?.plan).toBe("已经有了");
  });

  it("skips put when compose throws", async () => {
    const logs = new Map<string, DailyLog>();
    const wrote = await catchUpDiary({
      today: "2026-09-05",
      hasKey: true,
      getChat: async (d) => (d === "2026-09-04" ? yesterdayChat : { date: d, messages: [] }),
      listTodos: async () => [],
      getLog: async (d) => logs.get(d) ?? null,
      putLog: async (row) => {
        logs.set(row.date, row);
      },
      compose: async () => {
        throw new Error("日记这轮没写成");
      },
    });
    expect(wrote).toBeNull();
    expect(logs.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/diary.test.ts`

Expected: FAIL，`catchUpDiary` 仍返回 `null`，第一条用例期望 `"2026-09-04"`。

- [ ] **Step 3: Implement catchUpDiary**

替换 `src/diary.ts` 里的 `catchUpDiary` 占位：

```ts
export async function catchUpDiary(input: {
  today: string;
  hasKey: boolean;
  getChat: (date: string) => Promise<DayChat>;
  listTodos: () => Promise<Todo[]>;
  getLog: (date: string) => Promise<DailyLog | null>;
  putLog: (log: DailyLog) => Promise<void>;
  compose: (date: string) => Promise<DailyLog>;
}): Promise<string | null> {
  if (!input.hasKey) return null;
  const todos = await input.listTodos();
  const date = await pickCatchUpDate({
    today: input.today,
    hasLog: async (d) => (await input.getLog(d)) !== null,
    hasTraces: async (d) => hasDiaryTraces({ chat: await input.getChat(d), todos, date: d }),
  });
  if (!date) return null;
  try {
    const log = await input.compose(date);
    await input.putLog(log);
    return date;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/diary.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/diary.ts src/__tests__/diary.test.ts
git commit -m "$(cat <<'EOF'
feat: catch up the latest missing diary without asking

EOF
)"
```

---

### Task 5: 界面与 App 接线

**Files:**
- Modify: `src/screens/ChatScreen.vue`
- Modify: `src/screens/DiaryScreen.vue`
- Modify: `src/screens/SettingsScreen.vue`
- Modify: `src/App.vue`
- Modify: `src/styles.css`
- Modify: `demo/index.html`
- Modify: `src/__tests__/ritual.test.ts`
- Create: `src/__tests__/diary-screen.test.ts`

**Interfaces:**
- Consumes: `composeDailyLog`（Task 2）、`catchUpDiary`（Task 4）、`runAgent` 新签名（Task 3）、`effectiveApiKey`
- Produces:
  - `ChatScreen` 不再接收 `pendingLog` / `planConfirmed`，不再 emit `confirmLog` / `skipLog`
  - `DiaryScreen` props：`daily`、`date`、`composing?: boolean`；emit `compose`
  - `App.onTidy` 固定 `runTurn("morning", "自动整理。")`，并传 `planConfirmed: !!chat.planConfirmedAt`
  - `App` 冷启动、`visibilitychange`、每 60s 检查跨日，调用 `catchUpDiary`；成功则 `catchUpNote = "已补上上次的日记"`
  - 日记页按钮文案「整理成日记」

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/diary-screen.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DiaryScreen from "@/screens/DiaryScreen.vue";

describe("DiaryScreen", () => {
  it("emits compose from 整理成日记 and disables while composing", async () => {
    const w = mount(DiaryScreen, { props: { daily: null, date: "2026-09-05" } });
    expect(w.text()).toContain("整理成日记");
    expect(w.text()).toContain("明天打开会补上昨天");
    await w.get("[data-diary-compose]").trigger("click");
    expect(w.emitted("compose")).toHaveLength(1);

    await w.setProps({ composing: true });
    expect(w.get("[data-diary-compose]").attributes("disabled")).toBeDefined();
  });
});
```

`src/__tests__/ritual.test.ts` 增加：

```ts
it("shows 整理成日记 on the diary tab and keeps 自动整理 on chat", async () => {
  const w = mount(App);
  expect(w.text()).toContain("自动整理");
  expect(w.text()).toContain("刷新今天的待办");
  await w.get("[data-nav=diary]").trigger("click");
  expect(w.text()).toContain("整理成日记");
  expect(w.text()).not.toContain("自动整理");
  await w.get("[data-nav=chat]").trigger("click");
  expect(w.text()).toContain("自动整理");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/diary-screen.test.ts src/__tests__/ritual.test.ts`

Expected: FAIL，日记页没有按钮 / 对话空状态还是「定下来或结束今天」。

- [ ] **Step 3: Implement UI and wiring**

`src/screens/ChatScreen.vue`：

- 空状态文案：

```
想到什么直接说。
聊完点发送左边的「自动整理」，刷新今天的待办。
```

- 空状态条件去掉 `!pendingLog`
- 删除日记用的 `TodoConfirm`（「把上面写成今天的日记？」那一块）
- 删除 props：`pendingLog`、`planConfirmed`
- 删除 emits：`confirmLog`、`skipLog`
- 「自动整理」按钮去掉 `:class="{ end: planConfirmed }"`
- `watch` 依赖去掉 `pendingLog`

`src/screens/DiaryScreen.vue` 全文：

```vue
<template>
  <section class="screen on">
    <div class="diary-scroll">
      <div class="diary-head">
        <h2>日记</h2>
        <div class="count">只记今天</div>
      </div>
      <div v-if="!daily" class="empty">
        <div class="glyph">暮</div>
        <p>点下面「整理成日记」。今天不整的话，明天打开会补上昨天。</p>
      </div>
      <div v-else class="log-card">
        <div class="log-core">
          <h3>{{ dateLabel }}</h3>
          <div class="log-block">
            <div class="lab">早计划</div>
            <p>{{ daily.plan }}</p>
          </div>
          <div class="log-block">
            <div class="lab">做成了</div>
            <ul>
              <li v-for="(t, i) in daily.done" :key="'d' + i">{{ t }}</li>
              <li v-if="daily.done.length === 0">还没有勾掉的。</li>
            </ul>
          </div>
          <div class="log-block">
            <div class="lab">没做完</div>
            <ul>
              <li v-for="(t, i) in daily.undone" :key="'u' + i">{{ t }}</li>
              <li v-if="daily.undone.length === 0">全部勾完了。</li>
            </ul>
          </div>
          <div class="log-block">
            <div class="lab">状态</div>
            <div class="mood">{{ daily.state }}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="diary-compose">
      <button
        data-diary-compose
        class="diary-compose-btn"
        type="button"
        :disabled="composing"
        @click="emit('compose')"
      >
        {{ composing ? "正在整理…" : "整理成日记" }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DailyLog } from "@/types";

const props = defineProps<{
  daily: DailyLog | null;
  date: string;
  composing?: boolean;
}>();

const emit = defineEmits<{ compose: [] }>();

const dateLabel = computed(() => {
  const parts = props.date.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
});
</script>
```

`src/screens/SettingsScreen.vue` 朝暮分界 hint：

```
给对话一点时间感（现在像早上还是晚上）。自动整理只刷新今日待办，日记在日记页。默认 12。
```

`src/styles.css` 增加（可删 `.tidy.end`）：

```css
.catchup-note {
  margin: 0 18px 8px;
  font-size: 12px;
  color: var(--dusk);
  letter-spacing: 0.04em;
}
.diary-compose {
  padding: 8px 18px 10px;
}
.diary-compose-btn {
  width: 100%;
  height: 44px;
  border: 0;
  border-radius: 999px;
  background: rgba(142, 160, 200, 0.16);
  color: var(--dusk);
  cursor: pointer;
  font-family: "Noto Serif SC", serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.diary-compose-btn:active { transform: scale(0.98); }
.diary-compose-btn:disabled { opacity: 0.45; cursor: default; }
```

`src/App.vue` 关键改动（保留其余逻辑）：

模板：

- `ChatScreen` 去掉 `:pending-log`、`:plan-confirmed`、`@confirm-log`、`@skip-log`
- 顶栏日期下增加：`<p v-if="catchUpNote" class="catchup-note">{{ catchUpNote }}</p>`
- `DiaryScreen`：`:composing="composingDiary" @compose="onComposeDiary"`

脚本：

- 删除 `pendingLog`、`logResolve`、`onConfirmLogRequest`、`settleLog`、`onConfirmLog`、`onSkipLog`
- `agentDeps` 去掉 `writeDailyLog`、`onConfirmLog`
- `runTurn` 调用 `runAgent` 时加上 `planConfirmed: !!chat.value.planConfirmedAt`
- `onTidy`：

```ts
function onTidy() {
  void runTurn("morning", "自动整理。");
}
```

文件顶部增加 import：`composeDailyLog` 从 `@/agent/compose-log`，`catchUpDiary` 从 `@/diary`。

增加：

```ts
const composingDiary = ref(false);
const catchUpNote = ref("");
let catchUpRunning = false;
let dayTick: number | undefined;

async function runCatchUp() {
  await ready;
  if (catchUpRunning) return;
  catchUpRunning = true;
  try {
    const wrote = await catchUpDiary({
      today: localDate(),
      hasKey: !!effectiveApiKey(settings.value),
      getChat: (d) => chatRepo.get(d),
      listTodos: () => todoRepo.list(),
      getLog: (d) => logRepo.get(d),
      putLog: (log) => logRepo.put(log),
      compose: async (d) =>
        composeDailyLog({
          date: d,
          now: new Date(),
          chat: await chatRepo.get(d),
          todos: await todoRepo.list(),
          complete,
          model: settings.value.model,
        }),
    });
    if (wrote) catchUpNote.value = "已补上上次的日记";
  } finally {
    catchUpRunning = false;
  }
}

async function onComposeDiary() {
  await ready;
  if (composingDiary.value) return;
  composingDiary.value = true;
  try {
    const d = date.value;
    const log = await composeDailyLog({
      date: d,
      now: new Date(),
      chat: await chatRepo.get(d),
      todos: await todoRepo.list(),
      complete,
      model: settings.value.model,
    });
    await logRepo.put(log);
    if (log.date === date.value) daily.value = log;
  } catch (e) {
    const userMessage = e instanceof ApiError ? e.userMessage : "日记这轮没写成";
    debugLog.push({
      event: "http_fail",
      detail: e instanceof Error ? e.message : String(e),
    });
    catchUpNote.value = userMessage;
  } finally {
    composingDiary.value = false;
  }
}

async function rollToTodayIfNeeded() {
  const next = localDate();
  const session = ritualForNow(new Date(), settings.value.daySplitHour);
  if (next === date.value) {
    if (!awaiting.value) activeSession.value = session;
    return false;
  }
  date.value = next;
  activeSession.value = session;
  await ready;
  await loadDay(next);
  return true;
}

function onVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  void (async () => {
    await rollToTodayIfNeeded();
    await runCatchUp();
  })();
}
```

冷启动在 `ready` 末尾 `void runCatchUp()`（`runCatchUp` 内部会再 `await ready`，不会死锁：`ready` 在调用时已经 resolve 到这一行之后）。把 `void runCatchUp()` 放在 `ready` **后面**更干净：

```ts
const ready = (async () => {
  settings.value = await loadSettings();
  activeSession.value = ritualForNow(new Date(), settings.value.daySplitHour);
  todos.value = await todoRepo.list();
  await loadDay(date.value);
})();
void ready.then(() => runCatchUp());
```

`onMounted` / `onUnmounted`：定时器只看有没有跨日，不要每分钟打模型。

```ts
onMounted(() => {
  document.addEventListener("visibilitychange", onVisibilityChange);
  dayTick = window.setInterval(() => {
    void (async () => {
      const rolled = await rollToTodayIfNeeded();
      if (rolled) await runCatchUp();
    })();
  }, 60_000);
});
onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (dayTick !== undefined) window.clearInterval(dayTick);
});
```

`runTurn` 的 `finally` 里删掉 `if (logResolve) settleLog(false)`。

`demo/index.html`：对话空状态和 composer hint 改成「刷新今天的待办」；日记页加「整理成日记」按钮；自动整理演示不要再走到写日记。

- [ ] **Step 4: Run tests and typecheck**

Run:

```
npx vitest run
npx vue-tsc -b --pretty false
```

Expected: 全部 PASS，`vue-tsc` 无错误。`AgentDeps` 若还有 `writeDailyLog` 引用会在这里爆出来，当场删干净。

- [ ] **Step 5: Commit**

```bash
git add src/screens/ChatScreen.vue src/screens/DiaryScreen.vue src/screens/SettingsScreen.vue src/App.vue src/styles.css demo/index.html src/__tests__/ritual.test.ts src/__tests__/diary-screen.test.ts
git commit -m "$(cat <<'EOF'
feat: move diary compose to the diary tab and catch up on open

EOF
)"
```

---

## Self-Review

**Spec coverage**

| Spec | Task |
| --- | --- |
| 自动整理只刷新待办，一天可多次 | 3、5 `onTidy` |
| 待办必须确认 | 3，现有 `set_today_plan` |
| 已有计划再整理仍刷新待办 | 3 新用例 |
| 对话拿掉 `write_daily_log` | 3 |
| 日记页「整理成日记」，点了就写今天 | 5 |
| 生成中不可再点 | 5 |
| `composeDailyLog` 不走 `runAgent`、不插聊天 | 2 |
| done/undone 来自 `partitionTodos` | 2 `snapshotLogTitles` |
| 隔夜：启动 / 回前台 / 开着跨日 | 5 |
| 最多 14 天，只补最近一篇有痕迹无日记 | 1、4 |
| 无痕迹不补、有日记不覆盖 | 1、4 |
| 没 Key / 失败跳过、不挡第一屏 | 4、5 `void runCatchUp` |
| 不改 `when` | 4 |
| 空状态文案 | 5 |
| 朝暮分界不驱动按钮 | 5 Settings hint |
| 补写提示「已补上上次的日记」 | 5 |

**Placeholder scan:** `catchUpDiary` 占位只存在于 Task 1，Task 4 必须换成完整实现。计划正文无 TBD。

**Type consistency:** `composeDailyLog`、`catchUpDiary`、`pickCatchUpDate`、`hasDiaryTraces`、`shiftLocalDate`、`snapshotLogTitles` 在后续任务中的签名与 Task 1–2 一致。`AgentDeps` 在 Task 3 去掉日记字段后，Task 5 的 `agentDeps` 必须同步。
