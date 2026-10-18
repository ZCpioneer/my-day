import { describe, expect, it } from "vitest";
import { REPLY_CORPUS } from "@/agent/reply-corpus";

describe("REPLY_CORPUS", () => {
  it("覆盖冒头不问、答完才提议、独立小事、没点名不归组", () => {
    expect(REPLY_CORPUS.length).toBeGreaterThanOrEqual(5);
    expect(REPLY_CORPUS.some((c) => c.expect.noPropose && c.expect.question)).toBe(true);
    expect(REPLY_CORPUS.some((c) => c.expect.propose && (c.expect.titles?.length ?? 0) > 0)).toBe(true);
    expect(REPLY_CORPUS.some((c) => (c.expect.noProject?.length ?? 0) > 0)).toBe(true);
    expect(REPLY_CORPUS.some((c) => c.expect.noSetTodayPlan)).toBe(true);
  });

  it("每条都有非空输入和至少一个断言", () => {
    for (const c of REPLY_CORPUS) {
      expect(c.input.trim().length).toBeGreaterThan(0);
      const e = c.expect;
      const has =
        e.propose === true ||
        e.noPropose === true ||
        e.noSetTodayPlan === true ||
        e.question === true ||
        (e.titles?.length ?? 0) > 0 ||
        (e.noProject?.length ?? 0) > 0;
      expect(has, `语料「${c.input}」没有任何断言`).toBe(true);
    }
  });
});
