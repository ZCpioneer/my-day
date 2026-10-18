import { describe, it, expect } from "vitest";
import { closeVisibleSession, dayTranscript, sessionTranscript, shouldEveningGreet, shouldGreet } from "@/chat-session";
import type { ChatMessage, DayChat } from "@/types";

const msg = (id: string, content: string): ChatMessage => ({
  id,
  role: "user",
  content,
  createdAt: "2026-09-05T01:00:00.000Z",
});

describe("closeVisibleSession", () => {
  it("moves visible messages into archive and keeps planConfirmedAt", () => {
    const chat: DayChat = {
      date: "2026-09-05",
      messages: [msg("m1", "支付宝必须今天弄完")],
      archive: [msg("a1", "早上已经说过水电费")],
    };
    const next = closeVisibleSession(chat, "2026-09-05T08:00:00.000Z");
    expect(next.messages).toEqual([]);
    expect(next.archive?.map((m) => m.id)).toEqual(["a1", "m1"]);
    expect(next.planConfirmedAt).toBe("2026-09-05T08:00:00.000Z");
    expect(chat.messages).toHaveLength(1);
  });

  it("keeps an existing planConfirmedAt when a new stamp is not passed", () => {
    const next = closeVisibleSession({
      date: "2026-09-05",
      messages: [msg("m1", "hi")],
      planConfirmedAt: "2026-09-05T02:00:00.000Z",
    });
    expect(next.planConfirmedAt).toBe("2026-09-05T02:00:00.000Z");
    expect(next.archive?.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("shouldGreet", () => {
  it("greets when the day is completely untouched", () => {
    expect(shouldGreet({ date: "2026-09-06", messages: [] })).toBe(true);
  });

  it("does not greet once anything happened today", () => {
    expect(shouldGreet({ date: "2026-09-06", messages: [msg("m1", "早")] })).toBe(false);
    expect(
      shouldGreet({ date: "2026-09-06", messages: [], archive: [msg("a1", "说过了")] }),
    ).toBe(false);
    expect(
      shouldGreet({
        date: "2026-09-06",
        messages: [],
        planConfirmedAt: "2026-09-06T01:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("shouldEveningGreet", () => {
  const blank: DayChat = { date: "2026-09-07", messages: [] };

  it("18 点前不开场，18 点起开场", () => {
    expect(shouldEveningGreet(new Date(2026, 8, 7, 17, 59), blank, false)).toBe(false);
    expect(shouldEveningGreet(new Date(2026, 8, 7, 18, 0), blank, false)).toBe(true);
    expect(shouldEveningGreet(new Date(2026, 8, 7, 23, 30), blank, false)).toBe(true);
  });

  it("今天已有日记不开场", () => {
    expect(shouldEveningGreet(new Date(2026, 8, 7, 20, 0), blank, true)).toBe(false);
  });

  it("当天有对话（当前段或归档）或已确认计划都不开场", () => {
    const at = new Date(2026, 8, 7, 20, 0);
    expect(shouldEveningGreet(at, { date: "2026-09-07", messages: [msg("m1", "在聊")] }, false)).toBe(false);
    expect(
      shouldEveningGreet(at, { date: "2026-09-07", messages: [], archive: [msg("a1", "早上说过")] }, false),
    ).toBe(false);
    expect(
      shouldEveningGreet(
        at,
        { date: "2026-09-07", messages: [], planConfirmedAt: "2026-09-07T01:00:00.000Z" },
        false,
      ),
    ).toBe(false);
  });
});

describe("sessionTranscript / dayTranscript", () => {
  it("空会话给占位文案", () => {
    expect(sessionTranscript([])).toBe("（当前这段没有对话）");
    expect(dayTranscript({ date: "2026-09-07", messages: [] })).toBe("（当天没有对话）");
  });

  it("用户/秘书前缀拼接；整天把归档放在当前段前面", () => {
    expect(sessionTranscript([msg("m1", "买牛奶"), { ...msg("m2", "记下了"), role: "assistant" }])).toBe(
      "我：买牛奶\n秘书：记下了",
    );
    expect(
      dayTranscript({
        date: "2026-09-07",
        archive: [msg("a1", "早上说过水电")],
        messages: [msg("m1", "现在说牛奶")],
      }),
    ).toBe("我：早上说过水电\n我：现在说牛奶");
  });
});
