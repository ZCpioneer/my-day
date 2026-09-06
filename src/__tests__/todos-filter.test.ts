import { describe, it, expect } from "vitest";
import { filterPlanItems, filterProposedTodos } from "@/todos-filter";
import type { Todo } from "@/types";

const existing: Todo[] = [
  {
    id: "1",
    title: "整理支付宝调试问题并发群里询问",
    status: "open",
    sourceDate: "2026-09-05",
    createdAt: "2026-09-05T01:00:00.000Z",
  },
];

describe("filterProposedTodos", () => {
  it("drops empty titles", () => {
    expect(filterProposedTodos([{ title: "  " }], [])).toEqual([]);
  });
  it("drops duplicates ignoring case and spaces", () => {
    const out = filterProposedTodos(
      [{ title: "整理支付宝调试问题并发群里询问" }, { title: " 给房东转水电费 " }],
      existing,
    );
    expect(out.map((x) => x.title)).toEqual(["给房东转水电费"]);
  });
});

describe("filterPlanItems", () => {
  it("keeps today and later, drops blanks, and lets today win on duplicates", () => {
    const plan = filterPlanItems({
      today: [{ title: " 支付宝 " }, { title: " " }, { title: "水电" }],
      later: [{ title: "周报" }, { title: "支付宝" }, { title: "水电" }],
    });
    expect(plan.today.map((x) => x.title)).toEqual(["支付宝", "水电"]);
    expect(plan.later.map((x) => x.title)).toEqual(["周报"]);
    expect(plan.today.every((x) => x.when === "today")).toBe(true);
    expect(plan.later.every((x) => x.when === "later")).toBe(true);
  });

  it("spills extra today items into later so a day stays short", () => {
    const plan = filterPlanItems({
      today: [
        { title: "一" },
        { title: "二" },
        { title: "三" },
        { title: "四" },
        { title: "五" },
      ],
      later: [{ title: "以后的" }],
    });
    expect(plan.today.map((x) => x.title)).toEqual(["一", "二", "三", "四"]);
    expect(plan.later.map((x) => x.title)).toEqual(["五", "以后的"]);
  });

  it("treats legacy items as today", () => {
    const plan = filterPlanItems({
      items: [{ title: "支付宝" }],
      later: [{ title: "周报" }],
    });
    expect(plan.today.map((x) => x.title)).toEqual(["支付宝"]);
    expect(plan.later.map((x) => x.title)).toEqual(["周报"]);
  });
});
