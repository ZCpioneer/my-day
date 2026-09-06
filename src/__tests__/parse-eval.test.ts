import { describe, expect, it } from "vitest";
import { emptyParseResult } from "@/agent/parse";
import type { CorpusCase } from "@/agent/parse-corpus";
import { scoreCase } from "@/agent/parse-eval";

describe("scoreCase", () => {
  it("包含匹配：期望 task 命中即过", () => {
    const c: CorpusCase = { input: "x", expect: { tasks: ["交稿"] } };
    const r = { ...emptyParseResult(), tasks: [{ title: "明天下午三点前交稿" }] };
    expect(scoreCase(c, r).pass).toBe(true);
  });

  it("notTasks 命中即失败并给出原因", () => {
    const c: CorpusCase = { input: "x", expect: { notTasks: ["看海"] } };
    const r = { ...emptyParseResult(), tasks: [{ title: "去看海" }] };
    const s = scoreCase(c, r);
    expect(s.pass).toBe(false);
    expect(s.misses.join()).toContain("误抽 task");
  });

  it("记忆类别不一致算失败", () => {
    const c: CorpusCase = { input: "x", expect: { memories: [{ text: "早上不开会", kind: "preference" }] } };
    const r = { ...emptyParseResult(), memories: [{ text: "我早上不开会", kind: "goal" as const }] };
    const s = scoreCase(c, r);
    expect(s.pass).toBe(false);
    expect(s.misses.join()).toContain("类型");
  });

  it("chitchat 期望下六类全空才过", () => {
    const c: CorpusCase = { input: "x", expect: { chitchat: true } };
    expect(scoreCase(c, emptyParseResult()).pass).toBe(true);
    expect(scoreCase(c, { ...emptyParseResult(), events: ["有事"] }).pass).toBe(false);
  });
});
