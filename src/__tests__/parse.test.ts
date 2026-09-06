import { describe, expect, it } from "vitest";
import type { ChatCompletionResponse } from "@/api/deepseek";
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
      projectUpdates: [{ project: "朝暮", note: "解析层联调完了", status: "active" }, { note: "没项目名" }],
      waitings: [{ text: "等房东答复", waitingOn: "房东" }, { waitingOn: "没文本" }],
      waitingsResolved: ["房东答复了", 1],
      memories: [{ text: "早上不开会", kind: "preference" }, { text: "坏类型", kind: "mood" }],
    });
    expect(r.events).toEqual(["中午吃了螺蛳粉"]);
    expect(r.decisions).toEqual(["定了用 Postgres"]);
    expect(r.tasks).toEqual([
      { title: "明天下午三点前交稿", reason: undefined, priority: "high", due: "2026-09-07", project: "接私活" },
      { title: "坏优先级", reason: undefined, priority: undefined, due: undefined, project: undefined },
    ]);
    expect(r.projectUpdates).toEqual([{ project: "朝暮", note: "解析层联调完了", status: "active" }]);
    expect(r.waitings).toEqual([{ text: "等房东答复", waitingOn: "房东" }]);
    expect(r.waitingsResolved).toEqual(["房东答复了"]);
    expect(r.memories).toEqual([{ text: "早上不开会", kind: "preference" }]);
  });
});

describe("isChitchat", () => {
  it("六类全空才算纯闲聊", () => {
    expect(isChitchat(emptyParseResult())).toBe(true);
    expect(isChitchat({ ...emptyParseResult(), events: ["有事"] })).toBe(false);
  });
});

describe("parseSystemPrompt", () => {
  it("写入了随口一说/长期记忆两条核心判定规则", () => {
    const p = parseSystemPrompt();
    expect(p).toContain("随口一说");
    expect(p).toContain("一个月后");
    expect(p).toContain("只输出一个 JSON 对象");
  });
});

describe("parseInput", () => {
  it("成功时返回解析结果", async () => {
    const complete = async (): Promise<ChatCompletionResponse> => ({
      content:
        '{"events":["下雨了"],"decisions":[],"tasks":[],"projectUpdates":[],"waitings":[],"waitingsResolved":[],"memories":[]}',
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
