import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions } from "@/api/deepseek";
import { localDate, shiftLocalDate } from "@/dates";
import type { ReminderSpec } from "@/notify";
import { chatRepo, deleteDb, todoRepo } from "@/storage/db";
import App from "@/App.vue";

// 假 Notifier：记录每次 schedule 的全量规格，验证 App 的重排时机与 payload。
const notifier = vi.hoisted(() => ({
  scheduled: [] as ReminderSpec[][],
  requestPermission: vi.fn(async () => true),
  cancelAll: vi.fn(async () => {}),
  schedule: vi.fn(async (rs: ReminderSpec[]) => {
    notifier.scheduled.push(rs);
  }),
}));

const notifyListen = vi.hoisted(() => {
  let handler: (() => void) | null = null;
  return {
    listen: (onOpen: () => void) => {
      handler = onOpen;
      return () => {
        handler = null;
      };
    },
    fire: () => handler?.(),
  };
});

vi.mock("@/notify-capacitor", () => ({
  createNotifier: () => notifier,
  listenNotificationOpen: (onOpen: () => void) => notifyListen.listen(onOpen),
}));

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

describe("本地通知：App 接线", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    notifier.scheduled.length = 0;
    vi.clearAllMocks();
    // 垫一条消息，让 shouldGreet 为假，避免主动开场与用例抢 awaiting。
    await chatRepo.append(localDate(), {
      id: "seed",
      role: "user",
      content: "早",
      createdAt: "2026-09-07T00:30:00.000Z",
      mode: "chat",
    });
    // 今日桶 + 明天截止：无论几点跑测试，提醒点都在未来。
    await todoRepo.add({
      id: "due-1",
      title: "交房租",
      status: "open",
      sourceDate: localDate(),
      createdAt: "2026-09-07T01:00:00.000Z",
      when: "today",
      due: shiftLocalDate(localDate(), 1),
    });
    await todoRepo.add({
      id: "later-1",
      title: "周报",
      status: "open",
      sourceDate: localDate(),
      createdAt: "2026-09-07T01:00:00.000Z",
      when: "later",
    });
  });

  it("确认今日计划后重排提醒：先 cancelAll 再 schedule，带明天 due 的任务进通知", async () => {
    // 整理给出的计划保留「交房租」在今天桶，due 才不会被挪走。
    vi.mocked(chatCompletions).mockResolvedValue({
      content: '{"today":[{"title":"支付宝"},{"title":"交房租"}],"later":[{"title":"周报"}]}',
      tool_calls: [],
    });
    const w = mount(App);
    await waitFor(() => w.find("button.tidy").exists());
    // 启动那次重排已发生过，清掉记录，只看计划确认后的这轮。
    notifier.scheduled.length = 0;
    vi.clearAllMocks();

    await w.get("button.tidy").trigger("click");
    await waitFor(() => w.text().includes("这样排可以吗？"));
    await w.get(".btn-yes").trigger("click");
    await waitFor(() => notifier.schedule.mock.calls.length > 0);

    expect(notifier.cancelAll).toHaveBeenCalled();
    expect(notifier.requestPermission).toHaveBeenCalled();
    expect(notifier.cancelAll.mock.invocationCallOrder[0]).toBeLessThan(
      notifier.schedule.mock.invocationCallOrder[0],
    );
    const batch = notifier.scheduled.at(-1) ?? [];
    const hit = batch.find((r) => r.body === "交房租");
    expect(hit).toBeTruthy();
    // due 只有日期 → 明天 9:00。
    expect(hit?.at.getHours()).toBe(9);
    expect(hit?.at.getMinutes()).toBe(0);
    const todos = await todoRepo.list();
    expect(todos.some((t) => t.title === "交房租" && t.when === "today")).toBe(true);
  });

  it("点开通知把底栏切到待办", async () => {
    const w = mount(App);
    await waitFor(() => w.find("[data-nav=todo]").exists());
    expect(w.get("[data-nav=todo]").classes()).not.toContain("on");
    notifyListen.fire();
    await flushPromises();
    expect(w.get("[data-nav=todo]").classes()).toContain("on");
  });
});
