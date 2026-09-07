import { describe, it, expect } from "vitest";
import { KICKOFF_TEXT, systemPrompt, tidyPlanPrompt } from "@/agent/prompt";

describe("systemPrompt", () => {
  it("defines proactive duties: use yesterday's diary, advise on load, ask one question", () => {
    const p = systemPrompt();
    expect(p).toContain("昨天的日记");
    expect(p).toContain("截止时间");
    expect(p).toContain("每次只问一个问题");
    expect(p).toContain("主动开场");
  });

  it("keeps the hard rules: only propose, no diary, stop after confirm", () => {
    const p = systemPrompt();
    expect(p).toContain("不得口头声称已经记下");
    expect(p).toContain("propose_todos");
    expect(p).toContain("不要写日记");
    expect(p).toContain("本段对话即告结束");
  });

  it("引导归类：默认问拆分、小事问归属、独立不追问", () => {
    const p = systemPrompt();
    expect(p).toContain("拆成哪几步");
    expect(p).toContain("属于哪摊事");
    expect(p).toContain("独立的事");
  });
});

describe("KICKOFF_TEXT", () => {
  it("tells the agent the user just opened the app for the first time today", () => {
    expect(KICKOFF_TEXT).toContain("第一次打开");
  });
});

describe("tidyPlanPrompt", () => {
  it("forbids chatting and requires a JSON today+later replan", () => {
    const p = tidyPlanPrompt();
    expect(p).toContain("只输出一个 JSON 对象");
    expect(p).toContain("不要寒暄");
    expect(p).toContain("today");
    expect(p).toContain("later");
    expect(p).toContain("一天做不了太多");
  });
});
