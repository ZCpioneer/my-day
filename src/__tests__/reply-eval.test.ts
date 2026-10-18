import { describe, expect, it } from "vitest";
import { scoreReplyCase } from "@/agent/reply-eval";

describe("scoreReplyCase", () => {
  it("冒头出了提议算失败", () => {
    const s = scoreReplyCase(
      { input: "我要做一个AI视频", expect: { noPropose: true, question: true } },
      { text: "记下了", executedPropose: true, toolNames: ["propose_todos"], proposed: [{ title: "写脚本" }] },
    );
    expect(s.pass).toBe(false);
    expect(s.misses.join("")).toContain("不应提议");
  });

  it("问句且未提议通过", () => {
    const s = scoreReplyCase(
      { input: "我要做一个AI视频", expect: { noPropose: true, question: true } },
      { text: "这摊事要拆成哪几步？", executedPropose: false, toolNames: [], proposed: [] },
    );
    expect(s.pass).toBe(true);
  });

  it("应提议却未执行失败", () => {
    const s = scoreReplyCase(
      { input: "先写脚本再生成画面", expect: { propose: true, titles: ["写脚本"] } },
      { text: "好。", executedPropose: false, toolNames: [], proposed: [] },
    );
    expect(s.pass).toBe(false);
    expect(s.misses.join("")).toContain("应提议");
    expect(s.misses.join("")).toContain("缺提议:写脚本");
  });

  it("titles 命中且执行了提议则通过", () => {
    const s = scoreReplyCase(
      { input: "先写脚本", expect: { propose: true, titles: ["写脚本"] } },
      { text: "提议记下。", executedPropose: true, toolNames: ["propose_todos"], proposed: [{ title: "写脚本" }] },
    );
    expect(s.pass).toBe(true);
  });

  it("noProject 误带组失败", () => {
    const s = scoreReplyCase(
      { input: "买瓷砖", expect: { propose: true, noProject: ["装修"] } },
      {
        text: "记到以后。",
        executedPropose: true,
        toolNames: ["propose_todos"],
        proposed: [{ title: "买瓷砖", project: "装修" }],
      },
    );
    expect(s.pass).toBe(false);
    expect(s.misses.join("")).toContain("误带 project:装修");
  });

  it("noSetTodayPlan 命中 set_today_plan 失败", () => {
    const s = scoreReplyCase(
      { input: "我要做一个AI视频", expect: { noPropose: true, noSetTodayPlan: true } },
      { text: "今天先做这件。", executedPropose: true, toolNames: ["set_today_plan"], proposed: [] },
    );
    expect(s.pass).toBe(false);
    expect(s.misses.join("")).toContain("不应 set_today_plan");
  });

  it("普通问号也算问句", () => {
    const s = scoreReplyCase(
      { input: "买牛奶", expect: { question: true, noPropose: true } },
      { text: "记到以后吗？", executedPropose: false, toolNames: [], proposed: [] },
    );
    expect(s.pass).toBe(true);
  });
});
