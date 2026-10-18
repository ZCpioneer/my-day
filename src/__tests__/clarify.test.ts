import { describe, expect, it } from "vitest";
import {
  attributionTexts,
  isClarifyQuestion,
  prepareLaterProposals,
  projectMentioned,
  replyStillAsking,
} from "@/agent/clarify";

describe("isClarifyQuestion", () => {
  it("命中引导问", () => {
    expect(isClarifyQuestion("这摊事要拆成哪几步？")).toBe(true);
    expect(isClarifyQuestion("买瓷砖属于哪摊？")).toBe(true);
    expect(isClarifyQuestion("先定栏目还是先跑通一次？")).toBe(true);
    expect(isClarifyQuestion("从哪切入？")).toBe(true);
    expect(isClarifyQuestion("这摊视频，归属哪边？")).toBe(true);
  });

  it("不算引导问", () => {
    expect(isClarifyQuestion("")).toBe(false);
    expect(isClarifyQuestion("   ")).toBe(false);
    expect(isClarifyQuestion("今天排得下吗？")).toBe(false);
    expect(isClarifyQuestion("这样排可以吗？")).toBe(false);
    expect(isClarifyQuestion("明天还接着做吗？")).toBe(false);
    expect(isClarifyQuestion("标题可以吗？")).toBe(false);
    expect(isClarifyQuestion("今天先做哪件？")).toBe(false);
    expect(isClarifyQuestion("那你打算先弄哪块？")).toBe(false);
    expect(isClarifyQuestion("已记下，等你确认。")).toBe(false);
  });
});

describe("replyStillAsking", () => {
  it("问号，或对吧 / 说清 / 要不要记，都算还在问", () => {
    expect(replyStillAsking("三条链路具体是哪三条？")).toBe(true);
    expect(replyStillAsking("今天先动哪一件？")).toBe(true);
    expect(replyStillAsking("先放后面，等你说清要不要记。")).toBe(true);
    expect(replyStillAsking("是这三件，对吧")).toBe(true);
  });

  it("陈述句不算", () => {
    expect(replyStillAsking("")).toBe(false);
    expect(replyStillAsking("已记下，等你确认。")).toBe(false);
    expect(replyStillAsking("应用发布完成，今天算落地一件。")).toBe(false);
  });

  it("不放宽 isClarifyQuestion", () => {
    expect(isClarifyQuestion("三条链路具体是哪三条？")).toBe(false);
    expect(isClarifyQuestion("今天先动哪一件？")).toBe(false);
    expect(replyStillAsking("三条链路具体是哪三条？")).toBe(true);
  });
});

describe("projectMentioned / attributionTexts / prepareLaterProposals", () => {
  it("AI视频 对上 视频", () => {
    expect(projectMentioned("视频", ["我要做一个AI视频的事情"])).toBe(true);
    expect(projectMentioned("AI视频", ["写脚本，这摊视频"])).toBe(true);
    expect(projectMentioned("装修", ["买瓷砖"])).toBe(false);
  });

  it("归属窗口是本句加往前两轮", () => {
    const texts = attributionTexts("先写脚本，再生成画面", [
      { role: "user", content: "我要做一个AI视频的事情" },
      { role: "assistant", content: "这摊事要拆成哪几步？" },
    ]);
    expect(texts).toEqual(["先写脚本，再生成画面", "这摊事要拆成哪几步？", "我要做一个AI视频的事情"]);
  });

  it("窗口里点过名则保留组，否则剥掉；进以后；精确去重", () => {
    const items = [
      { title: "写脚本", project: "视频" },
      { title: "生成画面", project: "视频" },
      { title: "写脚本" },
      { title: "买瓷砖", project: "装修" },
    ];
    const texts = ["先写脚本，再生成画面", "这摊事要拆成哪几步？", "我要做一个AI视频"];
    const out = prepareLaterProposals(items, texts);
    expect(out.map((t) => ({ title: t.title, project: t.project, when: t.when }))).toEqual([
      { title: "写脚本", project: "视频", when: "later" },
      { title: "生成画面", project: "视频", when: "later" },
      { title: "买瓷砖", project: undefined, when: "later" },
    ]);
  });
});
