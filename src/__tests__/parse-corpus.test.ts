import { describe, expect, it } from "vitest";
import { PARSE_CORPUS } from "@/agent/parse-corpus";

const EXPECT_KEYS = ["tasks", "notTasks", "events", "decisions", "waitings", "chitchat"];

describe("PARSE_CORPUS", () => {
  it("至少 20 条，覆盖随口一说与「不落库」两类区分", () => {
    expect(PARSE_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(PARSE_CORPUS.some((c) => (c.expect.notTasks?.length ?? 0) > 0)).toBe(true);
    expect(PARSE_CORPUS.some((c) => (c.expect.tasks?.length ?? 0) > 0)).toBe(true);
    expect(PARSE_CORPUS.some((c) => c.expect.chitchat === true)).toBe(true);
  });

  it("每条都有非空输入和至少一个断言", () => {
    for (const c of PARSE_CORPUS) {
      expect(c.input.trim().length).toBeGreaterThan(0);
      const assertions = EXPECT_KEYS.some((k) => {
        const v = (c.expect as Record<string, unknown>)[k];
        return Array.isArray(v) ? v.length > 0 : v === true;
      });
      expect(assertions, `语料「${c.input}」没有任何断言`).toBe(true);
    }
  });

  it("chitchat 不与 tasks 断言混用", () => {
    for (const c of PARSE_CORPUS) {
      if (c.expect.chitchat) {
        expect(c.expect.tasks ?? []).toEqual([]);
      }
    }
  });

  it("confidence 期望必须挂在 expect.tasks 已有的 task 上", () => {
    for (const c of PARSE_CORPUS) {
      for (const cf of c.expect.confidence ?? []) {
        expect(
          c.expect.tasks ?? [],
          `语料「${c.input}」的 confidence 期望「${cf.task}」没有对应 tasks 断言`,
        ).toContain(cf.task);
      }
    }
  });
});
