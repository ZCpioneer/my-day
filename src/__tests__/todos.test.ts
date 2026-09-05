import { describe, it, expect } from "vitest";
import { applyTodayPlan, partitionTodos, snapshotLogTitles, todoWhen } from "@/todos";
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
