import { describe, it, expect } from "vitest";
import { buildContextMessages } from "@/agent/context";
import type { DailyLog } from "@/types";

const base = {
  date: "2026-09-06",
  timeLabel: "上午 08:00",
  mode: "chat" as const,
  todayTodos: [],
  laterTodos: [],
  doneToday: [],
  messages: [],
  planConfirmed: false,
};

const yesterday: DailyLog = {
  date: "2026-09-05",
  plan: "买显示器",
  done: ["买显示器"],
  undone: ["给房东转水电费"],
  state: "还行",
  updatedAt: "2026-09-05T13:00:00.000Z",
};

describe("buildContextMessages", () => {
  it("includes yesterday's diary as a fact when provided", () => {
    const msgs = buildContextMessages({ ...base, yesterdayLog: yesterday });
    const facts = msgs[0]?.content ?? "";
    expect(msgs[0]?.role).toBe("system");
    expect(facts).toContain("昨天的日记");
    expect(facts).toContain("买显示器");
    expect(facts).toContain("给房东转水电费");
  });

  it("omits the diary line when there is no log", () => {
    const msgs = buildContextMessages({ ...base, yesterdayLog: null });
    const facts = msgs[0]?.content ?? "";
    expect(facts).not.toContain("昨天的日记");
  });
});
