import { describe, it, expect } from "vitest";
import { applyFullPlan, applyMove, applyTodayPlan, partitionTodos, snapshotLogTitles, todoWhen } from "@/todos";
import type { Todo } from "@/types";

function todo(over: Partial<Todo> & Pick<Todo, "id" | "title">): Todo {
  return {
    status: "open",
    sourceDate: "2026-09-05",
    createdAt: "2026-09-05T01:00:00.000Z",
    ...over,
  };
}

describe("todoWhen", () => {
  it("treats missing when as today so old rows stay on today's list", () => {
    expect(todoWhen(todo({ id: "1", title: "周报" }))).toBe("today");
    expect(todoWhen(todo({ id: "2", title: "水电", when: "later" }))).toBe("later");
    expect(todoWhen(todo({ id: "3", title: "调试", when: "today" }))).toBe("today");
  });
});

describe("partitionTodos", () => {
  it("splits open today / later and only today's completions", () => {
    const rows: Todo[] = [
      todo({ id: "a", title: "支付宝", when: "today" }),
      todo({ id: "b", title: "周报", when: "later" }),
      todo({
        id: "c",
        title: "水电",
        when: "today",
        status: "done",
        completedAt: "2026-09-05T04:00:00.000Z",
      }),
      todo({
        id: "d",
        title: "昨天勾的",
        status: "done",
        completedAt: "2026-09-04T04:00:00.000Z",
      }),
    ];
    const p = partitionTodos(rows, "2026-09-05");
    expect(p.today.map((t) => t.title)).toEqual(["支付宝"]);
    expect(p.later.map((t) => t.title)).toEqual(["周报"]);
    expect(p.doneToday.map((t) => t.title)).toEqual(["水电"]);
  });

  it("orders by manual order first, then createdAt, then id", () => {
    const rows: Todo[] = [
      todo({ id: "b", title: "乙", when: "today", order: 2 }),
      todo({ id: "c", title: "丙", when: "today", createdAt: "2026-09-05T03:00:00.000Z" }),
      todo({ id: "a", title: "甲", when: "today", order: 0 }),
      todo({ id: "d", title: "丁", when: "today", createdAt: "2026-09-05T02:00:00.000Z" }),
    ];
    expect(partitionTodos(rows, "2026-09-05").today.map((t) => t.id)).toEqual(["a", "b", "d", "c"]);
  });
});

describe("applyMove", () => {
  const date = "2026-09-05";
  const threeToday = (): Todo[] => [
    todo({ id: "a", title: "甲", when: "today", createdAt: "2026-09-05T01:00:00.000Z" }),
    todo({ id: "b", title: "乙", when: "today", createdAt: "2026-09-05T02:00:00.000Z" }),
    todo({ id: "c", title: "丙", when: "today", createdAt: "2026-09-05T03:00:00.000Z" }),
  ];

  it("reorders within the same bucket and rewrites order", () => {
    const next = applyMove(threeToday(), "a", { when: "today", index: 1 }, date);
    const today = partitionTodos(next, date).today;
    expect(today.map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(today.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  it("drops back at the same spot without changing the sequence", () => {
    const next = applyMove(threeToday(), "b", { when: "today", index: 1 }, date);
    expect(partitionTodos(next, date).today.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("moves across buckets at the dropped position and compacts the source", () => {
    const rows = [
      ...threeToday(),
      todo({ id: "x", title: "先记着", when: "later", createdAt: "2026-09-05T04:00:00.000Z" }),
    ];
    const next = applyMove(rows, "c", { when: "later", index: 0 }, date);
    const p = partitionTodos(next, date);
    expect(p.later.map((t) => t.id)).toEqual(["c", "x"]);
    expect(next.find((t) => t.id === "c")).toMatchObject({ when: "later", order: 0 });
    expect(p.today.map((t) => t.order)).toEqual([0, 1]);
  });

  it("clamps an out-of-range index into the bucket", () => {
    const next = applyMove(threeToday(), "a", { when: "today", index: 99 }, date);
    expect(partitionTodos(next, date).today.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("returns the same array when the id is missing", () => {
    const rows = threeToday();
    expect(applyMove(rows, "nope", { when: "later", index: 0 }, date)).toBe(rows);
  });
});

describe("snapshotLogTitles", () => {
  it("uses today's plan only; later checkoffs are not 做成了", () => {
    const rows: Todo[] = [
      todo({ id: "a", title: "支付宝", when: "today" }),
      todo({
        id: "b",
        title: "水电",
        when: "today",
        status: "done",
        completedAt: "2026-09-05T04:00:00.000Z",
      }),
      todo({
        id: "c",
        title: "周报",
        when: "later",
        status: "done",
        completedAt: "2026-09-05T05:00:00.000Z",
      }),
    ];
    expect(snapshotLogTitles(rows, "2026-09-05")).toEqual({
      done: ["水电"],
      undone: ["支付宝"],
    });
  });
});

describe("applyTodayPlan", () => {
  it("promotes picked titles, demotes leftover today, and creates missing ones", () => {
    const existing: Todo[] = [
      todo({ id: "a", title: "支付宝", when: "later" }),
      todo({ id: "b", title: "周报", when: "today" }),
    ];
    const next = applyTodayPlan(existing, ["支付宝", "给房东转水电费"], {
      date: "2026-09-05",
      nowIso: "2026-09-05T02:00:00.000Z",
      newId: () => "new-1",
    });
    expect(next.find((t) => t.id === "a")?.when).toBe("today");
    expect(next.find((t) => t.id === "b")?.when).toBe("later");
    expect(next.find((t) => t.id === "new-1")).toMatchObject({
      title: "给房东转水电费",
      when: "today",
      status: "open",
    });
  });

  it("does not reopen a done item with the same title", () => {
    const existing: Todo[] = [
      todo({
        id: "a",
        title: "支付宝",
        status: "done",
        completedAt: "2026-09-05T04:00:00.000Z",
      }),
    ];
    const next = applyTodayPlan(existing, ["支付宝"], {
      date: "2026-09-05",
      nowIso: "2026-09-05T05:00:00.000Z",
      newId: () => "new-1",
    });
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("done");
  });
});

describe("applyFullPlan", () => {
  it("rewrites today and later together, creating missing titles", () => {
    const existing: Todo[] = [
      todo({ id: "a", title: "支付宝", when: "later" }),
      todo({ id: "b", title: "周报", when: "today" }),
      todo({ id: "c", title: "买菜", when: "later" }),
    ];
    const next = applyFullPlan(
      existing,
      { today: ["支付宝"], later: ["周报", "买机票"] },
      {
        date: "2026-09-05",
        nowIso: "2026-09-05T02:00:00.000Z",
        newId: () => "new-1",
      },
    );
    expect(next.find((t) => t.id === "a")?.when).toBe("today");
    expect(next.find((t) => t.id === "b")?.when).toBe("later");
    expect(next.find((t) => t.id === "c")?.when).toBe("later");
    expect(next.find((t) => t.id === "new-1")).toMatchObject({
      title: "买机票",
      when: "later",
      status: "open",
    });
  });

  it("does not delete an unmentioned later item or reopen a done title", () => {
    const existing: Todo[] = [
      todo({ id: "a", title: "周报", when: "later" }),
      todo({
        id: "b",
        title: "支付宝",
        status: "done",
        completedAt: "2026-09-05T04:00:00.000Z",
      }),
    ];
    const next = applyFullPlan(
      existing,
      { today: ["水电"], later: ["支付宝"] },
      {
        date: "2026-09-05",
        nowIso: "2026-09-05T05:00:00.000Z",
        newId: () => "new-1",
      },
    );
    expect(next.find((t) => t.id === "a")?.when).toBe("later");
    expect(next.find((t) => t.id === "b")?.status).toBe("done");
    expect(next.find((t) => t.id === "new-1")).toMatchObject({ title: "水电", when: "today" });
    expect(next.filter((t) => t.title === "支付宝")).toHaveLength(1);
  });
});
