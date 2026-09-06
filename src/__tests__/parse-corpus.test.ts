import { describe, expect, it } from "vitest";
import { PARSE_CORPUS } from "@/agent/parse-corpus";

const EXPECT_KEYS = ["tasks", "notTasks", "events", "decisions", "waitings", "memories", "notMemories", "chitchat"];

describe("PARSE_CORPUS", () => {
  it("至少 20 条，覆盖随口一说与长期记忆两类区分", () => {
    expect(PARSE_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(PARSE_CORPUS.some((c) => (c.expect.notTasks?.length ?? 0) > 0)).toBe(true);
    expect(PARSE_CORPUS.some((c) => (c.expect.memories?.length ?? 0) > 0)).toBe(true);
    expect(PARSE_CORPUS.some((c) => (c.expect.notMemories?.length ?? 0) > 0)).toBe(true);
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

  it("chitchat 不与其它断言混用，记忆类别合法", () => {
    for (const c of PARSE_CORPUS) {
      if (c.expect.chitchat) {
        expect(c.expect.tasks ?? []).toEqual([]);
        expect(c.expect.memories ?? []).toEqual([]);
      }
      for (const m of c.expect.memories ?? []) {
        expect(["preference", "goal", "watch"]).toContain(m.kind);
      }
    }
  });
});
