import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions } from "@/api/deepseek";
import { localDate, shiftLocalDate } from "@/dates";
import { chatRepo, deleteDb, logRepo } from "@/storage/db";
import App from "@/App.vue";
import type { DailyLog } from "@/types";

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

function mkLog(date: string, state: string): DailyLog {
  return { date, plan: "早计划", done: [], undone: [], state, updatedAt: `${date}T12:00:00.000Z` };
}

describe("diary history on the diary tab", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    await chatRepo.append(localDate(), {
      id: "m1",
      role: "user",
      content: "今天随便聊聊",
      createdAt: "2026-09-06T01:00:00.000Z",
      mode: "chat",
    });
  });

  it("shows past logs collapsed by date and expands on tap", async () => {
    const yesterday = shiftLocalDate(localDate(), -1);
    const twoDaysAgo = shiftLocalDate(localDate(), -2);
    await logRepo.put(mkLog(yesterday, "昨天的状态"));
    await logRepo.put(mkLog(twoDaysAgo, "前天的状态"));
    const w = mount(App);
    await waitFor(() => w.text().includes("今天随便聊聊"));
    await w.get('[data-nav="diary"]').trigger("click");
    await waitFor(() => w.text().includes("以往"));
    expect(w.text()).not.toContain("昨天的状态");
    await w.get(`[data-log-day="${yesterday}"]`).trigger("click");
    expect(w.text()).toContain("昨天的状态");
    expect(w.text()).not.toContain("前天的状态");
  });
});
