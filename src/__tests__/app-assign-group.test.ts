import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions } from "@/api/deepseek";
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

describe("手动改组到新建组", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    // 垫一条消息防止主动开场抢 awaiting
    await chatRepo.append(localDate(), {
      id: "m1",
      role: "user",
      content: "今天随便记一笔",
      createdAt: "2026-09-06T01:00:00.000Z",
      mode: "chat",
    });
    await todoRepo.add({
      id: "u1",
      title: "零散事",
      status: "open",
      sourceDate: localDate(),
      createdAt: "2026-09-06T01:00:00.000Z",
      when: "later",
    });
  });

  it("输入新组名建好后，任务立刻归到新分区而不是未分组", async () => {
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便记一笔"));
    await w.get("[data-nav=todo]").trigger("click");
    await waitFor(() => w.find("[data-todo=u1]").exists());

    const row = w.get("[data-todo=u1]");
    await row.get(".item").trigger("pointerdown", { clientX: 200, clientY: 20, pointerId: 1 });
    await row.get(".item").trigger("pointermove", { clientX: 110, clientY: 20, pointerId: 1 });
    await row.get(".item").trigger("pointerup", { clientX: 110, clientY: 20, pointerId: 1 });
    await waitFor(() => row.classes().includes("open"));
    await row.get("[data-todo-group]").trigger("click");
    await waitFor(() => w.find(".sheet").exists());

    await w.get(".sheet input").setValue("装修");
    await w.get("[data-new-confirm]").trigger("click");
    await waitFor(() => w.findAll("[data-group]").some((el) => el.text().includes("装修")));

    const section = w.findAll("[data-group]").find((el) => el.text().includes("装修"))!;
    expect(section.find("[data-todo=u1]").exists()).toBe(true);
    const ungrouped = w.find("[data-group='']");
    expect(ungrouped.exists() && ungrouped.find("[data-todo=u1]").exists()).toBe(false);
    expect(section.find(".group-name").text()).toBe("装修");

    const projects = await projectRepo.list();
    expect(projects.some((p) => p.title === "装修")).toBe(true);
    expect(vi.mocked(chatCompletions)).not.toHaveBeenCalled();
  });
});
