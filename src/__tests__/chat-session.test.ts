import { describe, it, expect } from "vitest";
import { closeVisibleSession, shouldGreet } from "@/chat-session";
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
