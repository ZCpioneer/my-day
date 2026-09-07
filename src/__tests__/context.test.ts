import { describe, it, expect } from "vitest";
import { buildContextMessages, selectRelevantEvents } from "@/agent/context";
import { emptyParseResult } from "@/agent/parse";
import type { ChatMessage, DailyLog, TimelineEvent } from "@/types";

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

  it("注入项目与等待中的摘要", () => {
    const msgs = buildContextMessages({
      ...base,
      projects: [
        { id: "p1", title: "日程秘书", status: "active", note: "解析层联调完了", createdAt: "", updatedAt: "" },
        { id: "p2", title: "旧项目", status: "done", createdAt: "", updatedAt: "" },
      ],
      waitings: [{ id: "w1", text: "等房东答复", waitingOn: "房东", since: "", fromMessageId: "m" }],
    });
    const facts = msgs[0]?.content ?? "";
    expect(facts).toContain("进行中的项目 1 个");
    expect(facts).toContain("日程秘书（解析层联调完了）");
    expect(facts).not.toContain("旧项目");
    expect(facts).toContain("等待中 1 件：等房东答复（等房东）");
  });

  it("待办摘要带上 priority/due/estimate/项目名", () => {
    const msgs = buildContextMessages({
      ...base,
      todayTodos: [
        {
          id: "t1",
          title: "交稿",
          status: "open",
          sourceDate: "2026-09-06",
          createdAt: "2026-09-06T01:00:00.000Z",
          priority: "high",
          due: "2026-09-07",
          estimate: 90,
          projectId: "p1",
        },
      ],
      projects: [{ id: "p1", title: "接私活", status: "active", createdAt: "", updatedAt: "" }],
    });
    const facts = msgs[0]?.content ?? "";
    expect(facts).toContain("交稿（急 · 明天 · 约1.5小时 · 接私活）");
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

  it("纯闲聊不注入事件；关联项目时注入近期相关事件", () => {
    const events: TimelineEvent[] = [
      { id: "e1", date: "2026-09-05", createdAt: "2026-09-05T01:00:00.000Z", kind: "event", text: "日程秘书解析层联调完了", fromMessageId: "m1" },
      { id: "e2", date: "2026-09-05", createdAt: "2026-09-05T02:00:00.000Z", kind: "event", text: "中午吃了螺蛳粉", fromMessageId: "m2" },
      { id: "e3", date: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", kind: "decision", text: "定了用 Postgres", fromMessageId: "m3" },
    ];
    const chitchat = buildContextMessages({ ...base, parseResult: null, recentEvents: events });
    expect(chitchat[0]?.content ?? "").not.toContain("近期相关记录");

    const withResult = buildContextMessages({
      ...base,
      parseResult: { ...emptyParseResult(), projectUpdates: [{ project: "日程秘书", note: "x" }] },
      recentEvents: events,
    });
    const facts = withResult[0]?.content ?? "";
    expect(facts).toContain("近期相关记录 2 条");
    expect(facts).toContain("日程秘书解析层联调完了");
    expect(facts).toContain("定了：定了用 Postgres");
    expect(facts).not.toContain("螺蛳粉");
  });

  it("selectRelevantEvents 最多取 10 条", () => {
    const events: TimelineEvent[] = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`,
      date: "2026-09-06",
      createdAt: `2026-09-06T${String(i).padStart(2, "0")}:00:00.000Z`,
      kind: "event" as const,
      text: `第${i}件`,
      fromMessageId: "m",
    }));
    const picked = selectRelevantEvents(events, { ...emptyParseResult(), events: ["有事"] }, "2026-09-06");
    expect(picked).toHaveLength(10);
    expect(picked[0].id).toBe("e5");
  });
});
