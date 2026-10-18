import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ApiError, chatCompletions } from "@/api/deepseek";
import { localDate, weekKey } from "@/dates";
import { chatRepo, deleteDb, weeklyRepo } from "@/storage/db";
import App from "@/App.vue";

vi.mock("@/api/deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/deepseek")>();
  return { ...actual, chatCompletions: vi.fn(), chatCompletionsStream: vi.fn() };
});

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 50; i++) {
    await flushPromises();
    if (check()) return;
  }
  throw new Error("timed out");
}

describe("weekly report on the diary tab", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    // 垫一条消息，避免主动开场抢 awaiting。
    await chatRepo.append(localDate(), {
      id: "m1",
      role: "user",
      content: "今天随便聊聊",
      createdAt: "2026-09-07T01:00:00.000Z",
      mode: "chat",
    });
  });

  it("生成 → 落库并展示；重新生成覆盖同周键", async () => {
    vi.mocked(chatCompletions).mockResolvedValue({
      content: '{"done":"做完了甲","undone":"乙剩一点","next":"下周收乙"}',
      tool_calls: [],
    });
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便聊聊"));
    await w.get('[data-nav="diary"]').trigger("click");
    await waitFor(() => w.text().includes("生成本周周报"));
    await w.get("[data-weekly-compose]").trigger("click");
    await waitFor(() => w.text().includes("做完了甲"));
    expect(w.text()).toContain("下周收乙");
    expect(w.text()).toContain("重新生成");
    expect((await weeklyRepo.get(weekKey(new Date())))?.done).toBe("做完了甲");

    vi.mocked(chatCompletions).mockResolvedValue({
      content: '{"done":"第二版","undone":"无","next":"继续"}',
      tool_calls: [],
    });
    await w.get("[data-weekly-compose]").trigger("click");
    await waitFor(() => w.text().includes("第二版"));
    expect(w.text()).not.toContain("做完了甲");
    expect((await weeklyRepo.get(weekKey(new Date())))?.done).toBe("第二版");
    expect(await weeklyRepo.list()).toHaveLength(1);
  });

  it("生成失败显示中文错误，周报区保持未生成态", async () => {
    vi.mocked(chatCompletions).mockRejectedValue(new ApiError("boom", 500, "模型这轮没回上，再说一次"));
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便聊聊"));
    await w.get('[data-nav="diary"]').trigger("click");
    await waitFor(() => w.text().includes("生成本周周报"));
    await w.get("[data-weekly-compose]").trigger("click");
    await waitFor(() => w.text().includes("模型这轮没回上，再说一次"));
    expect(w.text()).toContain("生成本周周报");
    expect(await weeklyRepo.get(weekKey(new Date()))).toBeNull();
  });
});
