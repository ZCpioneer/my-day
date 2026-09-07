import { describe, expect, it } from "vitest";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { debugLog } from "@/debug/log";
import { asParseResult, emptyParseResult, isChitchat, parseInput, parseSystemPrompt } from "@/agent/parse";

describe("asParseResult", () => {
  it("非法输入返回全空", () => {
    expect(asParseResult(undefined)).toEqual(emptyParseResult());
    expect(asParseResult("不是对象")).toEqual(emptyParseResult());
    expect(asParseResult({ tasks: "boom" })).toEqual(emptyParseResult());
  });

  it("逐条校验，丢弃坏条目保留好条目", () => {
    const r = asParseResult({
      events: ["中午吃了螺蛳粉", 42, ""],
      decisions: ["定了用 Postgres"],
      tasks: [
        { title: " 明天下午三点前交稿 ", priority: "high", due: "2026-09-07", project: " 接私活 " },
        { title: "" },
        { title: "坏优先级", priority: "urgent" },
        "不是对象",
      ],
      projectUpdates: [{ project: "日程秘书", note: "解析层联调完了", status: "active" }, { note: "没项目名" }],
      waitings: [{ text: "等房东答复", waitingOn: "房东" }, { waitingOn: "没文本" }],
      waitingsResolved: ["房东答复了", 1],
    });
    expect(r.events).toEqual(["中午吃了螺蛳粉"]);
    expect(r.decisions).toEqual(["定了用 Postgres"]);
    expect(r.tasks).toEqual([
      { title: "明天下午三点前交稿", reason: undefined, priority: "high", due: "2026-09-07", project: "接私活" },
      { title: "坏优先级", reason: undefined, priority: undefined, due: undefined, project: undefined },
    ]);
    expect(r.projectUpdates).toEqual([{ project: "日程秘书", note: "解析层联调完了", status: "active" }]);
    expect(r.waitings).toEqual([{ text: "等房东答复", waitingOn: "房东" }]);
    expect(r.waitingsResolved).toEqual(["房东答复了"]);
  });

  it("estimate 只收正数，非法值丢弃", () => {
    const r = asParseResult({
      tasks: [
        { title: "去银行", estimate: 90 },
        { title: "半小时的", estimate: 30.4 },
        { title: "负数", estimate: -5 },
        { title: "字符串", estimate: "一小时" },
      ],
    });
    expect(r.tasks[0].estimate).toBe(90);
    expect(r.tasks[1].estimate).toBe(30);
    expect(r.tasks[2].estimate).toBeUndefined();
    expect(r.tasks[3].estimate).toBeUndefined();
  });
});

describe("isChitchat", () => {
  it("六类全空才算纯闲聊", () => {
    expect(isChitchat(emptyParseResult())).toBe(true);
    expect(isChitchat({ ...emptyParseResult(), events: ["有事"] })).toBe(false);
  });
});

describe("parseSystemPrompt", () => {
  it("写入了随口一说的判定规则，且不做长期记忆", () => {
    const p = parseSystemPrompt();
    expect(p).toContain("随口一说");
    expect(p).toContain("只管当下");
    expect(p).not.toContain("memories");
    expect(p).toContain("只输出一个 JSON 对象");
  });
});

describe("parseInput", () => {
  it("带 recent 时把最近对话写进用户内容，并标注只是上下文", async () => {
    let seen = "";
    const complete = async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
      seen = String(req.messages[1]?.content ?? "");
      return { content: "{}", tool_calls: [] };
    };
    await parseInput({
      text: "装修那摊",
      date: "2026-09-06",
      todos: [],
      projects: [],
      model: "m",
      recent: [
        { role: "user", content: "下周要买瓷砖" },
        { role: "assistant", content: "这属于哪摊事？" },
      ],
      complete,
    });
    expect(seen).toContain("最近对话");
    expect(seen).toContain("用户：下周要买瓷砖");
    expect(seen).toContain("秘书：这属于哪摊事？");
    expect(seen).toContain("用户刚说：「装修那摊」");
  });

  it("不带 recent 时不出现上下文段落", async () => {
    let seen = "";
    const complete = async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
      seen = String(req.messages[1]?.content ?? "");
      return { content: "{}", tool_calls: [] };
    };
    await parseInput({ text: "hi", date: "2026-09-06", todos: [], projects: [], model: "m", complete });
    expect(seen).not.toContain("最近对话");
  });

  it("成功时返回解析结果", async () => {
    const complete = async (): Promise<ChatCompletionResponse> => ({
      content:
        '{"events":["下雨了"],"decisions":[],"tasks":[],"projectUpdates":[],"waitings":[],"waitingsResolved":[]}',
      tool_calls: [],
    });
    const r = await parseInput({ text: "下雨了", date: "2026-09-06", todos: [], projects: [], model: "m", complete });
    expect(r.events).toEqual(["下雨了"]);
  });

  it("输出不是 JSON 时不抛，记 parse_fail，返回全空", async () => {
    debugLog.clear();
    const complete = async (): Promise<ChatCompletionResponse> => ({ content: "聊得很好", tool_calls: [] });
    const r = await parseInput({ text: "hi", date: "2026-09-06", todos: [], projects: [], model: "m", complete });
    expect(r).toEqual(emptyParseResult());
    expect(debugLog.entries.some((e) => e.event === "parse_fail")).toBe(true);
  });

  it("网络失败时不抛，记 parse_fail，返回全空", async () => {
    debugLog.clear();
    const complete = async (): Promise<ChatCompletionResponse> => {
      throw new Error("没网");
    };
    const r = await parseInput({ text: "hi", date: "2026-09-06", todos: [], projects: [], model: "m", complete });
    expect(r).toEqual(emptyParseResult());
    expect(debugLog.entries.some((e) => e.event === "parse_fail")).toBe(true);
  });
});
