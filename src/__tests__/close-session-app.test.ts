import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions } from "@/api/deepseek";
import { localDate } from "@/dates";
import { chatRepo, deleteDb, todoRepo } from "@/storage/db";
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

function jsonTodayPlan() {
  vi.mocked(chatCompletions).mockResolvedValue({
    content: '{"today":[{"title":"支付宝"}],"later":[{"title":"周报"},{"title":"买机票"}]}',
    tool_calls: [],
  });
}

describe("confirming today's plan closes the visible session", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    await chatRepo.append(localDate(), {
      id: "m1",
      role: "user",
      content: "支付宝必须今天弄完",
      createdAt: "2026-09-05T01:00:00.000Z",
      mode: "chat",
    });
    await todoRepo.add({
      id: "later-1",
      title: "周报",
      status: "open",
      sourceDate: localDate(),
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "later",
    });
  });

  it("archives the thread after confirming the replan and writes later items", async () => {
    jsonTodayPlan();
    const w = mount(App);
    await waitFor(() => w.text().includes("支付宝必须今天弄完"));
    await w.get("button.tidy").trigger("click");
    await waitFor(() => w.text().includes("这样排可以吗？"));
    expect(w.text()).toContain("以后");
    expect(w.text()).toContain("买机票");
    expect(w.text()).not.toContain("请根据本段全部对话");
    await w.get(".btn-yes").trigger("click");
    await waitFor(() => !w.text().includes("支付宝必须今天弄完"));
    expect(w.text()).not.toContain("今日计划定了。");
    const day = await chatRepo.get(localDate());
    expect(day.messages).toEqual([]);
    expect(day.archive?.some((m) => m.content === "支付宝必须今天弄完")).toBe(true);
    expect(day.planConfirmedAt).toBeTruthy();
    const todos = await todoRepo.list();
    expect(todos.some((t) => t.title === "支付宝" && t.when === "today")).toBe(true);
    expect(todos.some((t) => t.title === "周报" && t.when === "later")).toBe(true);
    expect(todos.some((t) => t.title === "买机票" && t.when === "later")).toBe(true);
  });

  it("keeps the thread when the user skips", async () => {
    jsonTodayPlan();
    const w = mount(App);
    await waitFor(() => w.text().includes("支付宝必须今天弄完"));
    await w.get("button.tidy").trigger("click");
    await waitFor(() => w.text().includes("先不定"));
    await w.get(".btn-no").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("支付宝必须今天弄完");
    expect(w.text()).not.toContain("今日计划定了。");
    const day = await chatRepo.get(localDate());
    expect(day.messages.some((m) => m.content === "支付宝必须今天弄完")).toBe(true);
    expect(day.archive ?? []).toEqual([]);
    expect(day.planConfirmedAt).toBeUndefined();
  });
});
