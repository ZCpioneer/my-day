# 长按拖动改今天 / 以后 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 待办页「今天」「以后」未完成条目可长按拖到另一栏，只改 `when`，立刻写入。

**Architecture:** `todoRepo.setWhen` 只改一条的 `when`。落点判定和长按阈值放在 `src/todo-drag.ts`（纯函数）。`TodoRow` 识别长按并发出 `lift` / `drag` / `drop`；`TodoScreen` 量两栏区域、画抬起态、在换栏时 `emit('setWhen')`；`App.vue` 调用仓库。左滑删除、点选、栏内顺序都不动。

**Tech Stack:** Vue 3.5、Vite 6、TypeScript、Vitest、fake-indexeddb、@vue/test-utils、happy-dom。

## Global Constraints

- 用户自己拖不等于 Agent 写入；不走确认框。
- Agent 仍须确认才写入待办。
- 人手动拖到今天不卡 4 条上限。
- 不新增排序字段；只改 `when`。
- 已完成不能拖。点一下取消勾，回到原来的今天或以后。
- 左滑删除、点按勾选、列表滚动仍在；三种手势互不抢。
- 同时只抬一条。
- 界面中文。提示：`左滑删除 · 长按调栏`。
- 单机安卓，IndexedDB 库名 `zhaomu`。
- 不加 Capacitor Haptics 插件；振动用 `navigator.vibrate`。

---

## File Structure

```
src/todo-drag.ts                      # 长按阈值、落点、换栏判定、边缘滚动
src/storage/db.ts                     # todoRepo.setWhen
src/components/TodoRow.vue            # 长按抬起，发出 lift/drag/drop
src/screens/TodoScreen.vue            # 两栏区域、空槽、目标栏高亮、emit setWhen
src/App.vue                           # @setWhen → todoRepo.setWhen
src/styles.css                        # 空槽、抬起、目标栏、ghost
src/__tests__/todo-drag.test.ts
src/__tests__/todo-row.test.ts
src/__tests__/db.test.ts              # 追加 setWhen
src/__tests__/todos-screen.test.ts    # 提示、拖到另一栏
```

职责：`todo-drag.ts` 不碰 DOM。`TodoRow` 不管落在哪一栏。`TodoScreen` 不管 IndexedDB。

---

### Task 1: todoRepo.setWhen

**Files:**
- Modify: `src/storage/db.ts`
- Test: `src/__tests__/db.test.ts`

**Interfaces:**
- Consumes: existing `todoRepo.add` / `list`; `Todo.when`
- Produces: `todoRepo.setWhen(id: string, when: "today" | "later"): Promise<Todo>`

- [ ] **Step 1: Write the failing test**

Append inside `describe("todoRepo"` in `src/__tests__/db.test.ts`:

```ts
  it("setWhen moves today to later without touching status", async () => {
    await todoRepo.add({
      id: "t1",
      title: "支付宝",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "today",
    });
    await todoRepo.add({
      id: "t2",
      title: "周报",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "today",
    });
    const moved = await todoRepo.setWhen("t1", "later");
    expect(moved.when).toBe("later");
    expect(moved.status).toBe("open");
    expect(moved.completedAt).toBeUndefined();
    const listed = await todoRepo.list();
    expect(listed.find((t) => t.id === "t1")?.when).toBe("later");
    expect(listed.find((t) => t.id === "t2")?.when).toBe("today");
  });

  it("setWhen on a missing id throws", async () => {
    await expect(todoRepo.setWhen("nope", "today")).rejects.toThrow("todo not found");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/db.test.ts`

Expected: FAIL — `todoRepo.setWhen is not a function`

- [ ] **Step 3: Write minimal implementation**

In `src/storage/db.ts`, add next to `remove`:

```ts
  async setWhen(id: string, when: "today" | "later"): Promise<Todo> {
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    const todo = await new Promise<Todo>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as Todo);
      req.onerror = () => reject(req.error);
    });
    if (!todo) throw new Error("todo not found");
    todo.when = when;
    store.put(todo);
    await txDone(tx);
    db.close();
    return todo;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/db.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked to commit)

---

### Task 2: 落点与长按纯函数

**Files:**
- Create: `src/todo-drag.ts`
- Create: `src/__tests__/todo-drag.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `HOLD_MS = 450`
  - `HOLD_SLOP = 8`
  - `EDGE_PX = 36`
  - `type PlanBucket = "today" | "later"`
  - `type BucketRange = { top: number; bottom: number }`
  - `type BucketZones = { today: BucketRange; later: BucketRange }`
  - `movementCancelsHold(dx: number, dy: number): boolean`
  - `pickDragBucket(y: number, zones: BucketZones): PlanBucket | null`
  - `nextWhen(current: PlanBucket, bucket: PlanBucket | null): PlanBucket | null`
  - `edgeScrollDelta(y: number, view: BucketRange, edge?: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/todo-drag.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  EDGE_PX,
  HOLD_MS,
  HOLD_SLOP,
  edgeScrollDelta,
  movementCancelsHold,
  nextWhen,
  pickDragBucket,
} from "@/todo-drag";

const zones = {
  today: { top: 0, bottom: 120 },
  later: { top: 120, bottom: 300 },
};

describe("hold thresholds", () => {
  it("uses 450ms and 8px", () => {
    expect(HOLD_MS).toBe(450);
    expect(HOLD_SLOP).toBe(8);
    expect(EDGE_PX).toBe(36);
  });

  it("cancels hold once movement reaches the slop", () => {
    expect(movementCancelsHold(0, 0)).toBe(false);
    expect(movementCancelsHold(7, 7)).toBe(false);
    expect(movementCancelsHold(8, 0)).toBe(true);
    expect(movementCancelsHold(0, 8)).toBe(true);
  });
});

describe("pickDragBucket", () => {
  it("maps y onto today, later, or neither", () => {
    expect(pickDragBucket(10, zones)).toBe("today");
    expect(pickDragBucket(119, zones)).toBe("today");
    expect(pickDragBucket(120, zones)).toBe("later");
    expect(pickDragBucket(250, zones)).toBe("later");
    expect(pickDragBucket(300, zones)).toBe(null);
    expect(pickDragBucket(-4, zones)).toBe(null);
  });
});

describe("nextWhen", () => {
  it("only returns a value when dropping on the other bucket", () => {
    expect(nextWhen("today", "later")).toBe("later");
    expect(nextWhen("later", "today")).toBe("today");
    expect(nextWhen("today", "today")).toBe(null);
    expect(nextWhen("later", null)).toBe(null);
  });
});

describe("edgeScrollDelta", () => {
  it("scrolls when the finger is in the 36px edge", () => {
    const view = { top: 100, bottom: 500 };
    expect(edgeScrollDelta(200, view)).toBe(0);
    expect(edgeScrollDelta(120, view)).toBeLessThan(0);
    expect(edgeScrollDelta(480, view)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/todo-drag.test.ts`

Expected: FAIL — cannot find module `@/todo-drag`

- [ ] **Step 3: Write minimal implementation**

Create `src/todo-drag.ts`:

```ts
export const HOLD_MS = 450;
export const HOLD_SLOP = 8;
export const EDGE_PX = 36;

export type PlanBucket = "today" | "later";
export type BucketRange = { top: number; bottom: number };
export type BucketZones = { today: BucketRange; later: BucketRange };

export function movementCancelsHold(dx: number, dy: number): boolean {
  return Math.abs(dx) >= HOLD_SLOP || Math.abs(dy) >= HOLD_SLOP;
}

export function pickDragBucket(y: number, zones: BucketZones): PlanBucket | null {
  if (y >= zones.later.top && y < zones.later.bottom) return "later";
  if (y >= zones.today.top && y < zones.today.bottom) return "today";
  return null;
}

export function nextWhen(current: PlanBucket, bucket: PlanBucket | null): PlanBucket | null {
  if (!bucket || bucket === current) return null;
  return bucket;
}

export function edgeScrollDelta(y: number, view: BucketRange, edge: number = EDGE_PX): number {
  if (y < view.top + edge) return y - (view.top + edge);
  if (y > view.bottom - edge) return y - (view.bottom - edge);
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/todo-drag.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked to commit)

---

### Task 3: TodoRow 长按抬起

**Files:**
- Modify: `src/components/TodoRow.vue`
- Create: `src/__tests__/todo-row.test.ts`

**Interfaces:**
- Consumes: `HOLD_MS`, `movementCancelsHold` from `src/todo-drag.ts`
- Produces: emits `lift: [id]`, `drag: [id, clientY]`, `drop: [id, clientY]` in addition to existing `toggle` / `remove` / `reveal`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/todo-row.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import TodoRow from "@/components/TodoRow.vue";
import { HOLD_MS } from "@/todo-drag";
import type { Todo } from "@/types";

const openToday: Todo = {
  id: "t1",
  title: "支付宝",
  status: "open",
  sourceDate: "2026-09-05",
  createdAt: "2026-09-05T01:00:00.000Z",
  when: "today",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("TodoRow hold", () => {
  it("emits lift after holding still, and the following click does not toggle", async () => {
    vi.useFakeTimers();
    const w = mount(TodoRow, { props: { todo: openToday } });
    await w.get(".item").trigger("pointerdown", { clientX: 80, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(w.emitted("lift")?.[0]).toEqual(["t1"]);
    await w.get(".item").trigger("pointerup", { clientX: 80, clientY: 40, pointerId: 1 });
    await w.get(".item").trigger("click");
    expect(w.emitted("toggle")).toBeUndefined();
  });

  it("does not lift when the pointer moves first", async () => {
    vi.useFakeTimers();
    const w = mount(TodoRow, { props: { todo: openToday } });
    await w.get(".item").trigger("pointerdown", { clientX: 80, clientY: 40, pointerId: 1 });
    await w.get(".item").trigger("pointermove", { clientX: 80, clientY: 60, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(w.emitted("lift")).toBeUndefined();
  });

  it("does not lift a done row", async () => {
    vi.useFakeTimers();
    const w = mount(TodoRow, {
      props: {
        todo: { ...openToday, status: "done", completedAt: "2026-09-05T04:00:00.000Z" },
        done: true,
      },
    });
    await w.get(".item").trigger("pointerdown", { clientX: 80, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(w.emitted("lift")).toBeUndefined();
  });

  it("emits drag then drop with the pointer y after a lift", async () => {
    vi.useFakeTimers();
    const w = mount(TodoRow, { props: { todo: openToday } });
    await w.get(".item").trigger("pointerdown", { clientX: 80, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await w.get(".item").trigger("pointermove", { clientX: 80, clientY: 180, pointerId: 1 });
    await w.get(".item").trigger("pointerup", { clientX: 80, clientY: 180, pointerId: 1 });
    expect(w.emitted("drag")?.[0]).toEqual(["t1", 180]);
    expect(w.emitted("drop")?.[0]).toEqual(["t1", 180]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/todo-row.test.ts`

Expected: FAIL — `lift` not emitted (or emit type missing)

- [ ] **Step 3: Write minimal implementation**

Update `src/components/TodoRow.vue`:

- Import `HOLD_MS`, `movementCancelsHold` from `@/todo-drag`
- Add emits `lift`, `drag`, `drop`
- On pointerdown of an open row, start `setTimeout(HOLD_MS)`
- If movement cancels hold before the timer, clear it and keep existing swipe/scroll
- Timer fires: `x = 0`, `emit('reveal', null)`, `emit('lift', id)`, `navigator.vibrate?.(10)`
- After lift, pointermove emits `drag(id, clientY)` and does not run swipe
- pointerup after lift emits `drop(id, clientY)` and does not toggle
- `@contextmenu.prevent` on the item
- `done` rows never start the hold timer (swipe still works)

Keep the existing swipe axis lock for non-lifted pointers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/todo-row.test.ts src/__tests__/todos-screen.test.ts`

Expected: PASS (swipe delete tests still pass)

- [ ] **Step 5: Commit** (skip unless the user asked to commit)

---

### Task 4: TodoScreen 两栏拖放

**Files:**
- Modify: `src/screens/TodoScreen.vue`
- Modify: `src/styles.css`
- Modify: `src/__tests__/todos-screen.test.ts`

**Interfaces:**
- Consumes: `pickDragBucket`, `nextWhen`, `edgeScrollDelta`, `todoWhen`
- Produces: emit `setWhen: [id, "today" | "later"]`; hint copy `左滑删除 · 长按调栏`; `[data-bucket=today|later|done]` wrappers

- [ ] **Step 1: Write the failing tests**

Update `src/__tests__/todos-screen.test.ts` — change the existing hint assertion from `左滑删除` to `左滑删除 · 长按调栏`.

Append:

```ts
  it("emits setWhen when a today row is held and dropped on later", async () => {
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos: await todoRepo.list() } });
    const laterBox = w.get("[data-bucket=later]").element as HTMLElement;
    laterBox.getBoundingClientRect = () =>
      ({ top: 120, bottom: 300, left: 0, right: 300, width: 300, height: 180, x: 0, y: 120, toJSON() {} }) as DOMRect;
    const todayBox = w.get("[data-bucket=today]").element as HTMLElement;
    todayBox.getBoundingClientRect = () =>
      ({ top: 0, bottom: 120, left: 0, right: 300, width: 300, height: 120, x: 0, y: 0, toJSON() {} }) as DOMRect;

    const row = w.get("[data-todo=t1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(450);
    await row.trigger("pointermove", { clientX: 40, clientY: 180, pointerId: 1 });
    await row.trigger("pointerup", { clientX: 40, clientY: 180, pointerId: 1 });
    expect(w.emitted("setWhen")?.[0]).toEqual(["t1", "later"]);
    vi.useRealTimers();
  });

  it("does not emit setWhen when dropped back on today", async () => {
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos: await todoRepo.list() } });
    const laterBox = w.get("[data-bucket=later]").element as HTMLElement;
    laterBox.getBoundingClientRect = () =>
      ({ top: 120, bottom: 300, left: 0, right: 300, width: 300, height: 180, x: 0, y: 120, toJSON() {} }) as DOMRect;
    const todayBox = w.get("[data-bucket=today]").element as HTMLElement;
    todayBox.getBoundingClientRect = () =>
      ({ top: 0, bottom: 120, left: 0, right: 300, width: 300, height: 120, x: 0, y: 0, toJSON() {} }) as DOMRect;

    const row = w.get("[data-todo=t1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(450);
    await row.trigger("pointerup", { clientX: 40, clientY: 40, pointerId: 1 });
    expect(w.emitted("setWhen")).toBeUndefined();
    vi.useRealTimers();
  });
```

Add `import { vi } from "vitest"` if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/todos-screen.test.ts`

Expected: FAIL — hint text missing `长按调栏`, and/or `[data-bucket=later]` not found

- [ ] **Step 3: Write minimal implementation**

Wrap 今天 / 以后 / 已完成 in:

```html
<div class="todo-bucket" data-bucket="today" :class="{ drop: hover === 'today' }">...</div>
<div class="todo-bucket" data-bucket="later" :class="{ drop: hover === 'later' }">...</div>
<div class="todo-bucket" data-bucket="done">...</div>
```

Empty-state copy stays inside the matching wrapper.

Hint: `左滑删除 · 长按调栏`

`TodoRow` extra props/events:

```html
:lifted="liftId === t.id"
@lift="onLift"
@drag="onDrag"
@drop="onDrop"
```

Done rows do not bind lift (or bind but row ignores because `done`).

On lift: close swipe (`openId = null`), store `liftId`.
On drag: `hover = pickDragBucket(y, measureZones())`; if `edgeScrollDelta` ≠ 0, add it to `todo-scroll.scrollTop`. Add class `dragging` on the scroller so it does not pan with the finger (`overflow: hidden` while dragging).
On drop: `next = nextWhen(todoWhen(todo), pickDragBucket(y, zones))`; clear lift; if `next` then `emit('setWhen', id, next)`.

Ghost: a `position: fixed` copy of the title following `clientY`, `pointer-events: none`, scale 1.03. If `matchMedia('(prefers-reduced-motion: reduce)')` matches, skip the ghost and the scale; still change `when` on a valid drop.

Lifted row gets class `slot` (opacity ~0.35) as the empty slot.

CSS (append to `src/styles.css`):

```css
.todo-scroll.dragging { overflow: hidden; touch-action: none; }
.todo-bucket { border-radius: 18px; padding: 2px 2px 6px; }
.todo-bucket.drop { box-shadow: inset 0 0 0 1px rgba(224, 177, 90, 0.45); }
.todo-swipe.slot .item { opacity: 0.35; }
.todo-ghost {
  position: fixed;
  z-index: 30;
  pointer-events: none;
  left: 50%;
  width: min(100% - 36px, 384px);
  transform: translate(-50%, -50%) scale(1.03);
  padding: 14px 12px;
  border-radius: 18px;
  background: var(--panel);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  font-size: 14px;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/todos-screen.test.ts src/__tests__/todo-row.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (skip unless the user asked to commit)

---

### Task 5: App 写入

**Files:**
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `TodoScreen` emit `setWhen`; `todoRepo.setWhen`
- Produces: `onSetWhen(id, when)` refreshes `todos`

- [ ] **Step 1: No separate failing UI test** — persistence is covered by Task 1; the screen emit is covered by Task 4. Wire the handler.

In `src/App.vue` template:

```html
<TodoScreen
  v-else-if="tab === 'todo'"
  :todos="todos"
  @toggle="onToggle"
  @remove="onRemove"
  @set-when="onSetWhen"
/>
```

```ts
async function onSetWhen(id: string, when: "today" | "later") {
  await ready;
  await todoRepo.setWhen(id, when);
  todos.value = await todoRepo.list();
}
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`

Expected: all existing tests plus new ones PASS

- [ ] **Step 3: Commit** (skip unless the user asked to commit)

---

## Spec coverage

| Spec | Task |
|---|---|
| 长按 450ms / 位移 < 8px 才抬起 | 2, 3 |
| 横滑删除、竖滑滚动、按住再拖 | 3 |
| 点一下仍勾选；抬起后这次不勾 | 3 |
| 同时只抬一条 | 4 (`liftId`) |
| 拖时列表不跟手；边缘 36px 自动滚 | 2, 4 |
| 今天 / 以后区域含空状态；已完成和栏外弹回 | 2, 4 |
| 只改 `when`；不卡 4 条；无排序字段 | 1 |
| 已完成不能拖 | 3 |
| 提示 `左滑删除 · 长按调栏` | 4 |
| vibrate、挡住 contextmenu | 3 |
| reduced-motion 不飞，仍改栏 | 4 |
| 不走确认框 | 5 |
| 左滑删除、点选、自动整理、Agent 确认 | 不改 |
