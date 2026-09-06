import { describe, it, expect } from "vitest";
import { CATCH_UP_LOOKBACK_DAYS, catchUpDiary, hasDiaryTraces, pickCatchUpDate } from "@/diary";
import type { DailyLog, DayChat, Todo } from "@/types";

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
    expect(
      hasDiaryTraces({
        chat: chat({
          date: "2026-09-04",
          archive: [
            {
              id: "a1",
              role: "user",
              content: "早上聊过",
              createdAt: "2026-09-04T01:00:00.000Z",
            },
          ],
        }),
        todos: [],
        date: "2026-09-04",
      }),
    ).toBe(true);
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

describe("catchUpDiary", () => {
  const yesterdayChat: DayChat = {
    date: "2026-09-04",
    messages: [
      { id: "m1", role: "user", content: "hi", createdAt: "2026-09-04T01:00:00.000Z" },
    ],
  };
  const log: DailyLog = {
    date: "2026-09-04",
    plan: "先做支付宝",
    done: ["支付宝"],
    undone: ["周报"],
    state: "还行",
    updatedAt: "2026-09-05T00:01:00.000Z",
  };

  it("writes the picked day and does not touch todos", async () => {
    const logs = new Map<string, DailyLog>();
    const chats = new Map<string, DayChat>([["2026-09-04", yesterdayChat]]);
    const todos: Todo[] = [
      {
        id: "t1",
        title: "周报",
        status: "open",
        sourceDate: "2026-09-04",
        createdAt: "2026-09-04T01:00:00.000Z",
        when: "today",
      },
    ];
    const wrote = await catchUpDiary({
      today: "2026-09-05",
      hasKey: true,
      getChat: async (d) => chats.get(d) ?? { date: d, messages: [] },
      listTodos: async () => todos,
      getLog: async (d) => logs.get(d) ?? null,
      putLog: async (row) => {
        logs.set(row.date, row);
      },
      compose: async (d) => ({ ...log, date: d }),
    });
    expect(wrote).toBe("2026-09-04");
    expect(logs.get("2026-09-04")?.plan).toBe("先做支付宝");
    expect(todos[0].when).toBe("today");
    expect(todos[0].status).toBe("open");
  });

  it("skips when there is no key", async () => {
    let composed = 0;
    const wrote = await catchUpDiary({
      today: "2026-09-05",
      hasKey: false,
      getChat: async (d) => (d === "2026-09-04" ? yesterdayChat : { date: d, messages: [] }),
      listTodos: async () => [],
      getLog: async () => null,
      putLog: async () => {
        throw new Error("should not write");
      },
      compose: async () => {
        composed += 1;
        return log;
      },
    });
    expect(wrote).toBeNull();
    expect(composed).toBe(0);
  });

  it("does not overwrite an existing log", async () => {
    const logs = new Map<string, DailyLog>([["2026-09-04", { ...log, plan: "已经有了" }]]);
    let composed = 0;
    const wrote = await catchUpDiary({
      today: "2026-09-05",
      hasKey: true,
      getChat: async (d) => (d === "2026-09-04" ? yesterdayChat : { date: d, messages: [] }),
      listTodos: async () => [],
      getLog: async (d) => logs.get(d) ?? null,
      putLog: async (row) => {
        logs.set(row.date, row);
      },
      compose: async () => {
        composed += 1;
        return { ...log, plan: "新的" };
      },
    });
    expect(wrote).toBeNull();
    expect(composed).toBe(0);
    expect(logs.get("2026-09-04")?.plan).toBe("已经有了");
  });

  it("skips put when compose throws", async () => {
    const logs = new Map<string, DailyLog>();
    const wrote = await catchUpDiary({
      today: "2026-09-05",
      hasKey: true,
      getChat: async (d) => (d === "2026-09-04" ? yesterdayChat : { date: d, messages: [] }),
      listTodos: async () => [],
      getLog: async (d) => logs.get(d) ?? null,
      putLog: async (row) => {
        logs.set(row.date, row);
      },
      compose: async () => {
        throw new Error("日记这轮没写成");
      },
    });
    expect(wrote).toBeNull();
    expect(logs.size).toBe(0);
  });
});
