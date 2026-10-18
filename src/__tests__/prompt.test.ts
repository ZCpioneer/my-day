import { describe, it, expect } from "vitest";
import { diaryPrompt, EVENING_KICKOFF_TEXT, KICKOFF_TEXT, systemPrompt, tidyPlanPrompt, weeklyPrompt } from "@/agent/prompt";

describe("systemPrompt", () => {
  it("defines proactive duties: use yesterday's diary, advise on load, ask one question", () => {
    const p = systemPrompt();
    expect(p).toContain("昨天的日记");
    expect(p).toContain("每次只问一个问题");
    expect(p).toContain("主动开场");
  });

  it("说话极简：少句、加粗重点、不复述", () => {
    const p = systemPrompt();
    expect(p).toContain("默认一两句，最多三句");
    expect(p).toContain("**加粗**");
    expect(p).toContain("不要复述用户刚说的话");
    expect(p).toContain("任何回复默认不超过三句");
    expect(p).not.toContain("系统自动记好了");
  });

  it("keeps the hard rules: only propose, no diary, stop after confirm", () => {
    const p = systemPrompt();
    expect(p).toContain("不得口头声称已经记下");
    expect(p).toContain("propose_todos");
    expect(p).toContain("不要写日记");
    expect(p).toContain("本段对话即告结束");
  });

  it("先聊清楚再记：提问当轮禁止提议，不擅自归组", () => {
    const p = systemPrompt();
    expect(p).toContain("一摊事刚冒头");
    expect(p).toContain("禁止调用 propose_todos");
    expect(p).toContain("系统也不会弹解析确认框");
    expect(p).toContain("不要把新事归到现有项目");
    expect(p).toContain("属于哪摊");
    expect(p).toContain("阶段");
  });
});

describe("KICKOFF_TEXT", () => {
  it("tells the agent the user just opened the app for the first time today", () => {
    expect(KICKOFF_TEXT).toContain("第一次打开");
  });
});

describe("EVENING_KICKOFF_TEXT", () => {
  it("告诉模型现在是晚上、今天还没写日记", () => {
    expect(EVENING_KICKOFF_TEXT).toContain("晚上");
    expect(EVENING_KICKOFF_TEXT).toContain("还没写日记");
  });
});

describe("diaryPrompt", () => {
  it("只要 JSON，含 state/mood/cheer，复盘不要列清单", () => {
    const p = diaryPrompt();
    expect(p).toContain("只输出一个 JSON 对象");
    expect(p).toContain("state");
    expect(p).toContain("mood");
    expect(p).toContain("cheer");
    expect(p).toContain("不要列清单");
  });
});

describe("weeklyPrompt", () => {
  it("只要 JSON，含 done/undone/next", () => {
    const p = weeklyPrompt();
    expect(p).toContain("只输出一个 JSON 对象");
    expect(p).toContain("done");
    expect(p).toContain("undone");
    expect(p).toContain("next");
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
    expect(p).toContain("沿用原标题");
  });
});
