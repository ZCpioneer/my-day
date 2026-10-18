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

  it("chitchat 期望下全空才过", () => {
    const c: CorpusCase = { input: "x", expect: { chitchat: true } };
    expect(scoreCase(c, emptyParseResult()).pass).toBe(true);
    expect(scoreCase(c, { ...emptyParseResult(), events: ["有事"] }).pass).toBe(false);
  });

  it("confidence：期望与实际一致才过", () => {
    const c: CorpusCase = { input: "x", expect: { tasks: ["交稿"], confidence: [{ task: "交稿", confidence: "high" }] } };
    expect(scoreCase(c, { ...emptyParseResult(), tasks: [{ title: "明天交稿", confidence: "high" }] }).pass).toBe(true);
    const s = scoreCase(c, { ...emptyParseResult(), tasks: [{ title: "明天交稿", confidence: "low" }] });
    expect(s.pass).toBe(false);
    expect(s.misses.join()).toContain("置信度应为 high");
  });

  it("confidence：实际缺失按 low 比对", () => {
    const cLow: CorpusCase = { input: "x", expect: { tasks: ["保养"], confidence: [{ task: "保养", confidence: "low" }] } };
    expect(scoreCase(cLow, { ...emptyParseResult(), tasks: [{ title: "给车做保养" }] }).pass).toBe(true);
    const cHigh: CorpusCase = { input: "x", expect: { tasks: ["保养"], confidence: [{ task: "保养", confidence: "high" }] } };
    const s = scoreCase(cHigh, { ...emptyParseResult(), tasks: [{ title: "给车做保养" }] });
    expect(s.pass).toBe(false);
    expect(s.misses.join()).toContain("置信度应为 high");
  });

  it("confidence：期望没写就跳过（向后兼容）", () => {
    const c: CorpusCase = { input: "x", expect: { tasks: ["交稿"] } };
    expect(scoreCase(c, { ...emptyParseResult(), tasks: [{ title: "明天交稿", confidence: "low" }] }).pass).toBe(true);
  });
});
