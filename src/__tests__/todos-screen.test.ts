import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  it("只有点勾选框才勾掉，点标题/正文不勾", async () => {
    const w = mount(TodoScreen, {
      props: {
        todos: await todoRepo.list(),
      },
    });
    expect(w.text()).toContain("给房东转水电费");
    // 点标题/正文区域：不勾
    await w.get("[data-todo=t1] .item").trigger("click");
    expect(w.emitted("toggle")).toBeUndefined();
    // 点左侧勾选框：才 emit toggle（parent handles toggle in App; for unit test, TodoScreen emits toggle）
    await w.get("[data-todo=t1] .box").trigger("click");
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
    expect(w.text()).toContain("点开可改 · 左滑移动/分组/删除 · 长按拖动");
  });

  it("emits remove from the revealed delete button, not from a normal tap", async () => {
    const w = mount(TodoScreen, { props: { todos: await todoRepo.list() } });
    const row = w.get("[data-todo=t2]");
    // 普通点按文本：既不勾也不删
    await row.get(".item").trigger("click");
    expect(w.emitted("toggle")).toBeUndefined();
    expect(w.emitted("remove")).toBeUndefined();
    // 点勾选框：勾，不删
    await row.get(".box").trigger("click");
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

  it("以后栏按组分区：组名、进度、未分组区；已完成组不显示", async () => {
    localStorage.clear();
    const w = mount(TodoScreen, { props: { todos: groupedTodos, projects: groupedProjects } });
    await flushPromises();
    const keys = w.findAll("[data-group]").map((el) => el.attributes("data-group"));
    expect(keys).toEqual(["p1", ""]);
    expect(w.get("[data-group=p1]").text()).toContain("搬家");
    expect(w.get("[data-group=p1]").text()).toContain("1/3");
    expect(w.get("[data-group=p1]").text()).toContain("找房");
    expect(w.get("[data-group='']").text()).toContain("未分组");
    expect(w.get("[data-group='']").text()).toContain("零散事");
    // 已完成的组不在「以后」残留
    expect(w.find("[data-group=p2]").exists()).toBe(false);
  });

  it("空的进行中组也显示（便于拖入），且没有任务时不显示进度", async () => {
    localStorage.clear();
    const w = mount(TodoScreen, {
      props: { todos: [], projects: [groupedProjects[0]] },
    });
    await flushPromises();
    const head = w.get("[data-group=p1] .group-head");
    expect(head.text()).toContain("搬家");
    expect(head.find(".group-progress").exists()).toBe(false);
  });

  it("点「＋ 新建组」打开浮层，输入组名后 emit createGroup", async () => {
    localStorage.clear();
    const w = mount(TodoScreen, { props: { todos: [], projects: [] } });
    await flushPromises();
    await w.get("[data-group-add]").trigger("click");
    await w.get(".sheet input").setValue("装修");
    await w.get("[data-new-confirm]").trigger("click");
    expect(w.emitted("createGroup")?.[0]).toEqual(["装修"]);
  });

  it("点组标题折叠/展开，状态写进 localStorage", async () => {
    localStorage.clear();
    const w = mount(TodoScreen, { props: { todos: groupedTodos, projects: groupedProjects } });
    await flushPromises();
    await w.get("[data-group=p1] .group-head").trigger("click");
    expect(w.find("[data-group=p1] [data-todo=g1]").exists()).toBe(false);
    expect(JSON.parse(localStorage.getItem("ai-secretary.collapsed-groups")!)).toContain("p1");
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

describe("TodoScreen 组排序", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    // 组拖拽的 move/up 挂在 window 上，组件得挂进 document 事件才传播得到
    const w = mount(TodoScreen, { props: { todos: trioTodos, projects: trioProjects }, attachTo: document.body });
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

  it("拖到进行中组末尾：插入线画在末组下方（drop-end）", async () => {
    localStorage.clear();
    vi.useFakeTimers();
    const w = mount(TodoScreen, { props: { todos: trioTodos, projects: trioProjects }, attachTo: document.body });
    await flushPromises();
    mockRect(w.get("[data-group=p1]").element as HTMLElement, 0, 100);
    mockRect(w.get("[data-group=p2]").element as HTMLElement, 100, 200);
    mockRect(w.get("[data-group=p3]").element as HTMLElement, 200, 300);

    const handle = w.get("[data-group=p1] [data-group-handle]");
    await handle.trigger("pointerdown", { clientX: 10, clientY: 20, pointerId: 7 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    // 拖到 p3 中点（250）之下 → 进行中组末尾
    await handle.trigger("pointermove", { clientX: 10, clientY: 280, pointerId: 7 });
    expect(w.get("[data-group=p3]").classes()).toContain("drop-end");
    await handle.trigger("pointerup", { clientX: 10, clientY: 280, pointerId: 7 });
    expect(w.emitted("moveGroup")?.[0]).toEqual(["p1", 2]);
    w.unmount();
  });
});

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

describe("TodoScreen 手动新增", () => {
  it("显示加号悬浮按钮", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    expect(w.find("[data-todo-add]").exists()).toBe(true);
  });

  it("点加号打开新增浮层", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    await w.get("[data-todo-add]").trigger("click");
    expect(w.find("[data-add-sheet]").exists()).toBe(true);
    expect(w.get("[data-add-sheet]").text()).toContain("新增待办");
  });

  it("空标题不能提交", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    await w.get("[data-todo-add]").trigger("click");
    expect(w.get("[data-add-confirm]").attributes("disabled")).toBeDefined();
    await w.get("[data-add-confirm]").trigger("click");
    expect(w.emitted("add")).toBeUndefined();
  });

  it("填标题后确认 emit add，默认今天", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    await w.get("[data-todo-add]").trigger("click");
    await w.get("[data-add-title]").setValue("买牛奶");
    await w.get("[data-add-confirm]").trigger("click");
    expect(w.emitted("add")?.[0]).toEqual([{ title: "买牛奶", when: "today", projectId: null }]);
    expect(w.find("[data-add-sheet]").exists()).toBe(false);
  });

  it("选今天后确认 emit when today", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    await w.get("[data-todo-add]").trigger("click");
    await w.get("[data-add-title]").setValue("交房租");
    await w.get("[data-add-when=today]").trigger("click");
    await w.get("[data-add-confirm]").trigger("click");
    expect(w.emitted("add")?.[0]).toEqual([{ title: "交房租", when: "today", projectId: null }]);
  });

  it("点取消关闭浮层不 emit", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    await w.get("[data-todo-add]").trigger("click");
    await w.get("[data-add-title]").setValue("买牛奶");
    await w.get("[data-add-cancel]").trigger("click");
    expect(w.find("[data-add-sheet]").exists()).toBe(false);
    expect(w.emitted("add")).toBeUndefined();
  });

  it("标题两端空白会去掉", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    await w.get("[data-todo-add]").trigger("click");
    await w.get("[data-add-title]").setValue("  买牛奶  ");
    await w.get("[data-add-confirm]").trigger("click");
    expect(w.emitted("add")?.[0]).toEqual([{ title: "买牛奶", when: "today", projectId: null }]);
  });

  it("键盘顶起时浮层坐在 --kb 上面", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    expect(css).toMatch(/\.sheet-mask\s*\{[^}]*bottom:\s*var\(--kb/);
  });

  it("新增浮层能选已有组，确认 emit 带 projectId", async () => {
    const projects: Project[] = [
      { id: "p1", title: "搬家", status: "active", createdAt: "2026-09-06T01:00:00.000Z", updatedAt: "2026-09-06T01:00:00.000Z" },
      { id: "p2", title: "发布会", status: "done", createdAt: "2026-09-05T01:00:00.000Z", updatedAt: "2026-09-05T02:00:00.000Z" },
    ];
    const w = mount(TodoScreen, { props: { todos: [], projects } });
    await w.get("[data-todo-add]").trigger("click");
    const opts = w.get("[data-add-group]").findAll("option").map((o) => o.text());
    expect(opts).toContain("不分组");
    expect(opts).toContain("搬家");
    expect(opts).toContain("＋ 新组…");
    expect(opts).not.toContain("发布会");
    await w.get("[data-add-title]").setValue("找房");
    await w.get("[data-add-group]").setValue("p1");
    await w.get("[data-add-confirm]").trigger("click");
    expect(w.emitted("add")?.[0]).toEqual([{ title: "找房", when: "today", projectId: "p1" }]);
  });

  it("选新组并填名后 emit 新组名", async () => {
    const w = mount(TodoScreen, { props: { todos: [], projects: [] } });
    await w.get("[data-todo-add]").trigger("click");
    await w.get("[data-add-title]").setValue("打包");
    await w.get("[data-add-group]").setValue("__new__");
    await w.get("[data-add-group-new]").setValue("搬家");
    await w.get("[data-add-confirm]").trigger("click");
    expect(w.emitted("add")?.[0]).toEqual([{ title: "打包", when: "today", projectId: null, newTitle: "搬家" }]);
  });

  it("可填截止和急", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    await w.get("[data-todo-add]").trigger("click");
    await w.get("[data-add-title]").setValue("交稿");
    await w.get("[data-add-due]").setValue("2026-09-20");
    const hot = w.get("[data-add-priority]").element as HTMLInputElement;
    hot.checked = true;
    await w.get("[data-add-priority]").trigger("change");
    await w.get("[data-add-confirm]").trigger("click");
    expect(w.emitted("add")?.[0]?.[0]).toMatchObject({
      title: "交稿",
      when: "today",
      due: "2026-09-20",
      priority: "high",
    });
  });
});

describe("TodoScreen 编辑 / 逾期 / 等待 / 整理", () => {
  it("点标题打开编辑浮层，保存 emit update", async () => {
    const todos: Todo[] = [
      { id: "t1", title: "旧名", status: "open", sourceDate: "2026-09-14", createdAt: "2026-09-14T01:00:00.000Z", when: "today" },
    ];
    const w = mount(TodoScreen, { props: { todos } });
    await w.get("[data-todo-title]").trigger("click");
    expect(w.get("[data-add-sheet]").text()).toContain("改待办");
    await w.get("[data-add-title]").setValue("新名");
    await w.get("[data-add-confirm]").trigger("click");
    expect(w.emitted("update")?.[0]?.[0]).toBe("t1");
    expect(w.emitted("update")?.[0]?.[1]).toMatchObject({ title: "新名", when: "today" });
  });

  it("逾期的以后事项出现在今天的逾期区，不在以后分区", async () => {
    const todos: Todo[] = [
      { id: "late", title: "过期稿", status: "open", sourceDate: "2026-09-01", createdAt: "2026-09-01T01:00:00.000Z", when: "later", due: "2020-01-01" },
      { id: "ok", title: "以后再说", status: "open", sourceDate: "2026-09-14", createdAt: "2026-09-14T01:00:00.000Z", when: "later" },
    ];
    const w = mount(TodoScreen, { props: { todos } });
    expect(w.get("[data-bucket=today]").text()).toContain("过期稿");
    expect(w.get("[data-bucket=today]").text()).toContain("逾期");
    expect(w.get("[data-bucket=later]").text()).not.toContain("过期稿");
    expect(w.get("[data-bucket=later]").text()).toContain("以后再说");
  });

  it("等待事项可点等到了", async () => {
    const w = mount(TodoScreen, {
      props: {
        todos: [],
        waitings: [{ id: "w1", text: "等房东答复", waitingOn: "房东", since: "2026-09-06T01:00:00.000Z", fromMessageId: "m1" }],
      },
    });
    expect(w.get("[data-bucket=waiting]").text()).toContain("等房东答复");
    await w.get("[data-waiting-done]").trigger("click");
    expect(w.emitted("resolveWaiting")?.[0]).toEqual(["w1"]);
  });

  it("整理按钮 emit tidy；空态能打开今天新增", async () => {
    const w = mount(TodoScreen, { props: { todos: [] } });
    await w.get("[data-todo-tidy]").trigger("click");
    expect(w.emitted("tidy")).toHaveLength(1);
    await w.get("[data-empty-add-today]").trigger("click");
    expect(w.find("[data-add-sheet]").exists()).toBe(true);
  });

  it("撤销条在有 undoTitle 时出现", async () => {
    const w = mount(TodoScreen, { props: { todos: [], undoTitle: "周报" } });
    expect(w.get("[data-todo-undo]").text()).toContain("周报");
    await w.get("[data-todo-undo-btn]").trigger("click");
    expect(w.emitted("undoRemove")).toHaveLength(1);
  });
});
