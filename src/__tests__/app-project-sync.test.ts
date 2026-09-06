import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { localDate } from "@/dates";
import { chatRepo, deleteDb, projectRepo, todoRepo } from "@/storage/db";
import App from "@/App.vue";

vi.mock("@/api/deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/deepseek")>();
  return { ...actual, chatCompletions: vi.fn() };
});

async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 50; i++) {
    await flushPromises();
    if (await check()) return;
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
