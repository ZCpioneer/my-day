import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import TodoScreen from "@/screens/TodoScreen.vue";
import { todoRepo, deleteDb } from "@/storage/db";
import { HOLD_MS } from "@/todo-drag";
import type { Project, Todo } from "@/types";

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
    mockRect(w.get("[data-group='']").element as HTMLElement, 120, 300);

    const row = w.get("[data-todo=t1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await row.trigger("pointermove", { clientX: 40, clientY: 180, pointerId: 1 });
    await row.trigger("pointerup", { clientX: 40, clientY: 180, pointerId: 1 });
    // later 桶里已有 t2（未 mock 尺寸，中点为 0），落点在其下方 → 排到第 1 位
    expect(w.emitted("move")?.[0]).toEqual(["t1", "later", 1, null]);
  });

  it("still emits move if the browser cancels the pointer mid-drag", async () => {
    const todos = await todoRepo.list();
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos } });
    mockRect(w.get("[data-bucket=today]").element as HTMLElement, 0, 120);
    mockRect(w.get("[data-bucket=later]").element as HTMLElement, 120, 300);
    mockRect(w.get("[data-group='']").element as HTMLElement, 120, 300);

    const row = w.get("[data-todo=t1] .item");
    await row.trigger("pointerdown", { clientX: 40, clientY: 40, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await row.trigger("pointermove", { clientX: 40, clientY: 90, pointerId: 1 });
    await row.trigger("pointercancel", { clientX: 40, clientY: 90, pointerId: 1 });
    await row.trigger("pointermove", { clientX: 40, clientY: 180, pointerId: 1 });
    await row.trigger("pointerup", { clientX: 40, clientY: 180, pointerId: 1 });
    expect(w.emitted("move")?.[0]).toEqual(["t1", "later", 1, null]);
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

describe("TodoScreen 跨组拖拽", () => {
  // 与上面 TodoScreen describe 一样：fake timers 用后复原，否则会拖垮下一个用例的 beforeEach（IndexedDB）
  afterEach(() => {
    vi.useRealTimers();
  });

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
