import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions } from "@/api/deepseek";
import { localDate } from "@/dates";
import { chatRepo, deleteDb, projectRepo, todoRepo } from "@/storage/db";
import App from "@/App.vue";

vi.mock("@/api/deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/deepseek")>();
  return { ...actual, chatCompletions: vi.fn(), chatCompletionsStream: vi.fn() };
});

async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 50; i++) {
    await flushPromises();
    if (await check()) return;
  }
  throw new Error("timed out");
}

describe("待办页手动新增", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    await chatRepo.append(localDate(), {
      id: "m1",
      role: "user",
      content: "今天随便记一笔",
      createdAt: "2026-09-06T01:00:00.000Z",
      mode: "chat",
    });
  });

  it("加号把事项写进今天并落库", async () => {
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便记一笔"));
    await w.get("[data-nav=todo]").trigger("click");
    await waitFor(() => w.find("[data-todo-add]").exists());

    await w.get("[data-todo-add]").trigger("click");
    await waitFor(() => w.find("[data-add-sheet]").exists());
    await w.get("[data-add-title]").setValue("买牛奶");
    await w.get("[data-add-confirm]").trigger("click");
    await waitFor(() => w.text().includes("买牛奶"));

    const todos = await todoRepo.list();
    expect(todos.some((t) => t.title === "买牛奶" && t.when === "today" && t.status === "open")).toBe(true);
    expect(w.find("[data-bucket=today]").text()).toContain("买牛奶");
    expect(vi.mocked(chatCompletions)).not.toHaveBeenCalled();
  });

  it("选今天则进今天桶", async () => {
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便记一笔"));
    await w.get("[data-nav=todo]").trigger("click");
    await waitFor(() => w.find("[data-todo-add]").exists());

    await w.get("[data-todo-add]").trigger("click");
    await waitFor(() => w.find("[data-add-sheet]").exists());
    await w.get("[data-add-title]").setValue("交房租");
    await w.get("[data-add-when=today]").trigger("click");
    await w.get("[data-add-confirm]").trigger("click");
    await waitFor(() => w.text().includes("交房租"));

    const todos = await todoRepo.list();
    expect(todos.some((t) => t.title === "交房租" && t.when === "today")).toBe(true);
    expect(w.find("[data-bucket=today]").text()).toContain("交房租");
  });

  it("选已有组则事项进该分区", async () => {
    await projectRepo.upsertByTitle("搬家", {});
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便记一笔"));
    await w.get("[data-nav=todo]").trigger("click");
    await waitFor(() => w.find("[data-todo-add]").exists());

    await w.get("[data-todo-add]").trigger("click");
    await waitFor(() => w.find("[data-add-sheet]").exists());
    await w.get("[data-add-title]").setValue("找房");
    const projects = await projectRepo.list();
    const pid = projects.find((p) => p.title === "搬家")!.id;
    await w.get("[data-add-when=later]").trigger("click");
    await w.get("[data-add-group]").setValue(pid);
    await w.get("[data-add-confirm]").trigger("click");
    await waitFor(() => w.text().includes("找房"));

    const todos = await todoRepo.list();
    expect(todos.some((t) => t.title === "找房" && t.projectId === pid)).toBe(true);
    expect(w.get(`[data-group=${pid}]`).text()).toContain("找房");
  });

  it("新建组则事项进新分区", async () => {
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便记一笔"));
    await w.get("[data-nav=todo]").trigger("click");
    await waitFor(() => w.find("[data-todo-add]").exists());

    await w.get("[data-todo-add]").trigger("click");
    await waitFor(() => w.find("[data-add-sheet]").exists());
    await w.get("[data-add-title]").setValue("打包");
    await w.get("[data-add-when=later]").trigger("click");
    await w.get("[data-add-group]").setValue("__new__");
    await w.get("[data-add-group-new]").setValue("搬家");
    await w.get("[data-add-confirm]").trigger("click");
    await waitFor(() => w.findAll("[data-group]").some((el) => el.text().includes("搬家")));

    const section = w.findAll("[data-group]").find((el) => el.text().includes("搬家"))!;
    expect(section.text()).toContain("打包");
    const projects = await projectRepo.list();
    expect(projects.some((p) => p.title === "搬家")).toBe(true);
    const pid = projects.find((p) => p.title === "搬家")!.id;
    const todos = await todoRepo.list();
    expect(todos.some((t) => t.title === "打包" && t.projectId === pid)).toBe(true);
  });

  it("新增可带截止和急", async () => {
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便记一笔"));
    await w.get("[data-nav=todo]").trigger("click");
    await waitFor(() => w.find("[data-todo-add]").exists());

    await w.get("[data-todo-add]").trigger("click");
    await waitFor(() => w.find("[data-add-sheet]").exists());
    await w.get("[data-add-title]").setValue("交稿");
    await w.get("[data-add-due]").setValue("2099-01-02");
    const box = w.get("[data-add-priority]").element as HTMLInputElement;
    box.checked = true;
    await w.get("[data-add-priority]").trigger("change");
    await w.get("[data-add-confirm]").trigger("click");
    await waitFor(() => w.text().includes("交稿"));

    const todos = await todoRepo.list();
    const hit = todos.find((t) => t.title === "交稿");
    expect(hit?.due).toBe("2099-01-02");
    expect(hit?.priority).toBe("high");
    expect(hit?.when).toBe("today");
  });

  it("未完成的重复标题不落库", async () => {
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便记一笔"));
    await w.get("[data-nav=todo]").trigger("click");
    await waitFor(() => w.find("[data-todo-add]").exists());

    await w.get("[data-todo-add]").trigger("click");
    await waitFor(() => w.find("[data-add-sheet]").exists());
    await w.get("[data-add-title]").setValue("买牛奶");
    await w.get("[data-add-confirm]").trigger("click");
    await waitFor(() => w.text().includes("买牛奶"));

    await w.get("[data-todo-add]").trigger("click");
    await waitFor(() => w.find("[data-add-sheet]").exists());
    await w.get("[data-add-title]").setValue(" 买牛奶 ");
    await w.get("[data-add-confirm]").trigger("click");
    await waitFor(() => !w.find("[data-add-sheet]").exists());

    const todos = (await todoRepo.list()).filter((t) => t.title.trim() === "买牛奶" || t.title === "买牛奶");
    expect(todos.filter((t) => t.status === "open")).toHaveLength(1);
  });
});
