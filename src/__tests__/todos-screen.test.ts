import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import TodoScreen from "@/screens/TodoScreen.vue";
import { todoRepo, deleteDb } from "@/storage/db";
import { HOLD_MS } from "@/todo-drag";
import type { Todo } from "@/types";

function mockRect(el: HTMLElement, top: number, bottom: number) {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom,
      left: 0,
      right: 300,
      width: 300,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON() {},
    }) as DOMRect;
}

beforeEach(async () => {
  await deleteDb();
  await todoRepo.add({
    id: "t1",
    title: "给房东转水电费",
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
    when: "later",
  });
});

describe("TodoScreen", () => {
  it("toggles a row into 已经勾掉", async () => {
    const w = mount(TodoScreen, {
      props: {
        todos: await todoRepo.list(),
      },
    });
    expect(w.text()).toContain("给房东转水电费");
    await w.get("[data-todo=t1] .item").trigger("click");
    // parent handles toggle in App; for unit test, TodoScreen emits toggle
    expect(w.emitted("toggle")?.[0]).toEqual(["t1"]);
  });

  it("shows today, later, and done sections", async () => {
    const w = mount(TodoScreen, {
      props: {
        todos: await todoRepo.list(),
      },
    });
    expect(w.text()).toContain("今天");
    expect(w.text()).toContain("以后");
    expect(w.text()).toContain("已完成");
    expect(w.text()).toContain("周报");
    expect(w.text()).toContain("左滑删除 · 长按拖动");
  });

  it("emits remove from the revealed delete button, not from a normal tap", async () => {
    const w = mount(TodoScreen, { props: { todos: await todoRepo.list() } });
    const row = w.get("[data-todo=t2]");
    await row.get(".item").trigger("click");
    expect(w.emitted("toggle")?.[0]).toEqual(["t2"]);
    expect(w.emitted("remove")).toBeUndefined();

    await row.get(".item").trigger("pointerdown", { clientX: 200, clientY: 20, pointerId: 1 });
    await row.get(".item").trigger("pointermove", { clientX: 110, clientY: 20, pointerId: 1 });
    await row.get(".item").trigger("pointerup", { clientX: 110, clientY: 20, pointerId: 1 });
    expect(row.classes()).toContain("open");
    await row.get("[data-todo-del]").trigger("click");
    expect(w.emitted("remove")?.[0]).toEqual(["t2"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits move when a today row is held and dropped on later", async () => {
    const todos = await todoRepo.list();
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos } });
    mockRect(w.get("[data-bucket=today]").element as HTMLElement, 0, 120);
    mockRect(w.get("[data-bucket=later]").element as HTMLElement, 120, 300);

    const row = w.get("[data-todo=t1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await row.trigger("pointermove", { clientX: 40, clientY: 180, pointerId: 1 });
    await row.trigger("pointerup", { clientX: 40, clientY: 180, pointerId: 1 });
    // later 桶里已有 t2（未 mock 尺寸，中点为 0），落点在其下方 → 排到第 1 位
    expect(w.emitted("move")?.[0]).toEqual(["t1", "later", 1]);
  });

  it("still emits move if the browser cancels the pointer mid-drag", async () => {
    const todos = await todoRepo.list();
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos } });
    mockRect(w.get("[data-bucket=today]").element as HTMLElement, 0, 120);
    mockRect(w.get("[data-bucket=later]").element as HTMLElement, 120, 300);

    const row = w.get("[data-todo=t1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await row.trigger("pointermove", { clientX: 40, clientY: 90, pointerId: 1 });
    await row.trigger("pointercancel", { clientX: 40, clientY: 90, pointerId: 1 });
    await row.trigger("pointermove", { clientX: 40, clientY: 180, pointerId: 1 });
    await row.trigger("pointerup", { clientX: 40, clientY: 180, pointerId: 1 });
    expect(w.emitted("move")?.[0]).toEqual(["t1", "later", 1]);
  });

  it("does not emit move when dropped back at its own spot", async () => {
    const todos = await todoRepo.list();
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos } });
    mockRect(w.get("[data-bucket=today]").element as HTMLElement, 0, 120);
    mockRect(w.get("[data-bucket=later]").element as HTMLElement, 120, 300);

    const row = w.get("[data-todo=t1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await row.trigger("pointerup", { clientX: 40, clientY: 40, pointerId: 1 });
    expect(w.emitted("move")).toBeUndefined();
  });

  it("reorders within the bucket and marks the insertion line", async () => {
    const todos: Todo[] = ["t1", "t2", "t3"].map((id, i) => ({
      id,
      title: `事${id}`,
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: `2026-09-05T0${i + 1}:00:00.000Z`,
      when: "today",
    }));
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos } });
    const bucket = w.get("[data-bucket=today]");
    mockRect(bucket.element as HTMLElement, 0, 400);
    mockRect(w.get("[data-bucket=later]").element as HTMLElement, 400, 500);
    mockRect(w.get("[data-todo=t1]").element as HTMLElement, 0, 100);
    mockRect(w.get("[data-todo=t2]").element as HTMLElement, 100, 200);
    mockRect(w.get("[data-todo=t3]").element as HTMLElement, 200, 300);

    const row = w.get("[data-todo=t1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    // 拖到 t2 中点（150）之下、t3 中点（250）之上 → 插到第 1 位，线画在 t3 上方
    await row.trigger("pointermove", { clientX: 40, clientY: 180, pointerId: 1 });
    expect(w.get("[data-todo=t1]").classes()).toContain("slot");
    expect(w.get("[data-todo=t3]").classes()).toContain("drop-before");
    await row.trigger("pointerup", { clientX: 40, clientY: 180, pointerId: 1 });
    expect(w.emitted("move")?.[0]).toEqual(["t1", "today", 1]);
  });
});
