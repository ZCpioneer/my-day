import { describe, it, expect } from "vitest";
import { buildContextMessages } from "@/agent/context";
import type { ChatMessage, DailyLog } from "@/types";

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

  it("注入项目、等待中、长期记忆三块摘要", () => {
    const msgs = buildContextMessages({
      ...base,
      projects: [
        { id: "p1", title: "朝暮", status: "active", note: "解析层联调完了", createdAt: "", updatedAt: "" },
        { id: "p2", title: "旧项目", status: "done", createdAt: "", updatedAt: "" },
      ],
      waitings: [{ id: "w1", text: "等房东答复", waitingOn: "房东", since: "", fromMessageId: "m" }],
      memories: [{ id: "m1", text: "早上不开会", kind: "preference", createdAt: "" }],
    });
    const facts = msgs[0]?.content ?? "";
    expect(facts).toContain("进行中的项目 1 个");
    expect(facts).toContain("朝暮（解析层联调完了）");
    expect(facts).not.toContain("旧项目");
    expect(facts).toContain("等待中 1 件：等房东答复（等房东）");
    expect(facts).toContain("长期记忆 1 条：[偏好]早上不开会");
  });

  it("聊天历史截断为最近 12 条", () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      role: "user",
      content: `第${i}句`,
      createdAt: "2026-09-06T01:00:00.000Z",
    }));
    const msgs = buildContextMessages({ ...base, messages });
    const contents = msgs.map((m) => m.content).join("\n");
    expect(contents).not.toContain("第0句");
    expect(contents).not.toContain("第7句");
    expect(contents).toContain("第8句");
    expect(contents).toContain("第19句");
  });
});
