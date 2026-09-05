import { describe, it, expect } from "vitest";
import { filterProposedTodos } from "@/todos-filter";
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
