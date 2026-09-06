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

  it("does not drop on pointercancel after lift, and keeps dragging", async () => {
    vi.useFakeTimers();
    const w = mount(TodoRow, { props: { todo: openToday } });
    await w.get(".item").trigger("pointerdown", { clientX: 80, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await w.get(".item").trigger("pointermove", { clientX: 80, clientY: 90, pointerId: 1 });
    await w.get(".item").trigger("pointercancel", { clientX: 80, clientY: 90, pointerId: 1 });
    expect(w.emitted("drop")).toBeUndefined();
    await w.get(".item").trigger("pointermove", { clientX: 80, clientY: 180, pointerId: 1 });
    await w.get(".item").trigger("pointerup", { clientX: 80, clientY: 180, pointerId: 1 });
    expect(w.emitted("drag")?.at(-1)).toEqual(["t1", 180]);
    expect(w.emitted("drop")?.[0]).toEqual(["t1", 180]);
  });
});
