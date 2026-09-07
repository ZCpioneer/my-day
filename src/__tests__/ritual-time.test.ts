import { describe, it, expect } from "vitest";
import { buildContextMessages } from "@/agent/context";
import { clampSplitHour, ritualForHour } from "@/ritual";
import type { ChatMessage, Todo } from "@/types";

describe("ritualForHour", () => {
  it("treats hours before 12 as morning and 12+ as evening", () => {
    expect(ritualForHour(0, 12)).toBe("morning");
    expect(ritualForHour(11, 12)).toBe("morning");
    expect(ritualForHour(12, 12)).toBe("evening");
    expect(ritualForHour(23, 12)).toBe("evening");
  });

  it("respects a custom split", () => {
    expect(ritualForHour(13, 18)).toBe("morning");
    expect(ritualForHour(18, 18)).toBe("evening");
  });

  it("clamps split hour", () => {
    expect(clampSplitHour(-3)).toBe(0);
    expect(clampSplitHour(30)).toBe(23);
  });
});

describe("buildContextMessages", () => {
  it("keeps the whole day's chat and reports today / later / done", () => {
    const today: Todo[] = [
      {
        id: "t1",
        title: "支付宝调试",
        status: "open",
        sourceDate: "2026-09-05",
        createdAt: "2026-09-05T01:00:00.000Z",
        when: "today",
      },
    ];
    const later: Todo[] = [
      {
        id: "t3",
        title: "周报",
        status: "open",
        sourceDate: "2026-09-05",
        createdAt: "2026-09-05T01:00:00.000Z",
        when: "later",
      },
    ];
    const done: Todo[] = [
      {
        id: "t2",
        title: "水电费",
        status: "done",
        sourceDate: "2026-09-05",
        createdAt: "2026-09-05T01:00:00.000Z",
        completedAt: "2026-09-05T10:00:00.000Z",
        when: "today",
      },
    ];
    const msgs: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: "支付宝必须今天弄完",
        createdAt: "2026-09-05T01:00:00.000Z",
        mode: "morning",
      },
      {
        id: "m2",
        role: "assistant",
        content: "那就先做支付宝",
        createdAt: "2026-09-05T01:01:00.000Z",
        mode: "morning",
      },
    ];
    const out = buildContextMessages({
      date: "2026-09-05",
      timeLabel: "下午 15:00",
      mode: "evening",
      todayTodos: today,
      laterTodos: later,
      doneToday: done,
      messages: msgs,
      planConfirmed: true,
    });
    const blob = JSON.stringify(out);
    expect(blob).toContain("支付宝必须今天弄完");
    expect(blob).toContain("今天 1 件：支付宝调试");
    expect(blob).toContain("以后 1 件：周报");
    expect(blob).toContain("今日已完成 1 件：水电费");
    expect(blob).toContain("待办列表是唯一真相");
    expect(blob).toContain("整理今日待办");
  });

  it("truncates the session to the most recent turns (facts now live in the parse layer)", () => {
    const messages: ChatMessage[] = Array.from({ length: 18 }, (_, i) => ({
      id: `m${i}`,
      role: "user" as const,
      content: `第${i}句`,
      createdAt: "2026-09-05T01:00:00.000Z",
    }));
    const out = buildContextMessages({
      date: "2026-09-05",
      timeLabel: "下午 15:00",
      mode: "morning",
      todayTodos: [],
      laterTodos: [],
      doneToday: [],
      messages,
      planConfirmed: false,
    });
    const blob = JSON.stringify(out);
    expect(blob).not.toContain("第0句");
    expect(blob).toContain("第6句");
    expect(blob).toContain("第17句");
  });
});
