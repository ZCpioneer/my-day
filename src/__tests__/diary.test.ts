import { describe, it, expect } from "vitest";
import { CATCH_UP_LOOKBACK_DAYS, hasDiaryTraces, pickCatchUpDate } from "@/diary";
import type { DayChat, Todo } from "@/types";

function chat(over: Partial<DayChat> & Pick<DayChat, "date">): DayChat {
  return { messages: [], ...over };
}

describe("hasDiaryTraces", () => {
  it("is true when that day has messages, a confirmed plan, or a completion", () => {
    expect(hasDiaryTraces({ chat: chat({ date: "2026-09-04" }), todos: [], date: "2026-09-04" })).toBe(false);
    expect(
      hasDiaryTraces({
        chat: chat({
          date: "2026-09-04",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "hi",
              createdAt: "2026-09-04T01:00:00.000Z",
            },
          ],
        }),
        todos: [],
        date: "2026-09-04",
      }),
    ).toBe(true);
    expect(
      hasDiaryTraces({
        chat: chat({ date: "2026-09-04", planConfirmedAt: "2026-09-04T02:00:00.000Z" }),
        todos: [],
        date: "2026-09-04",
      }),
    ).toBe(true);
    const done: Todo = {
      id: "t1",
      title: "支付宝",
      status: "done",
      sourceDate: "2026-09-04",
      createdAt: "2026-09-04T01:00:00.000Z",
      completedAt: "2026-09-04T12:00:00.000Z",
      when: "today",
    };
    expect(hasDiaryTraces({ chat: chat({ date: "2026-09-04" }), todos: [done], date: "2026-09-04" })).toBe(true);
    expect(hasDiaryTraces({ chat: chat({ date: "2026-09-05" }), todos: [done], date: "2026-09-05" })).toBe(false);
  });
});

describe("pickCatchUpDate", () => {
  it("picks the most recent date with traces and no log, within 14 days", async () => {
    expect(CATCH_UP_LOOKBACK_DAYS).toBe(14);
    const logs = new Set(["2026-09-05"]);
    const traces = new Set(["2026-09-04", "2026-09-02"]);
    const picked = await pickCatchUpDate({
      today: "2026-09-05",
      hasLog: async (d) => logs.has(d),
      hasTraces: async (d) => traces.has(d),
    });
    expect(picked).toBe("2026-09-04");
  });

  it("skips yesterday when it has a log and takes the next traced gap", async () => {
    const logs = new Set(["2026-09-04"]);
    const traces = new Set(["2026-09-04", "2026-09-02"]);
    const picked = await pickCatchUpDate({
      today: "2026-09-05",
      hasLog: async (d) => logs.has(d),
      hasTraces: async (d) => traces.has(d),
    });
    expect(picked).toBe("2026-09-02");
  });

  it("returns null when nothing in the window qualifies", async () => {
    const picked = await pickCatchUpDate({
      today: "2026-09-05",
      hasLog: async () => false,
      hasTraces: async () => false,
    });
    expect(picked).toBeNull();
  });
});
