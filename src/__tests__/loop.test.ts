import { describe, it, expect } from "vitest";
import { runAgent, MAX_MODEL_CALLS } from "@/agent/loop";
import type { AgentDeps } from "@/agent/loop";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { debugLog } from "@/debug/log";
import type { Todo } from "@/types";

function deps(over: Partial<AgentDeps> & { complete: AgentDeps["complete"] }): AgentDeps {
  return {
    listTodos: async () => [],
    setTodayPlan: async () => {},
    addTodos: async () => {},
    now: () => new Date(2026, 8, 5, 8, 0, 0),
    onPropose: async (items) => items,
    ...over,
  };
}

describe("runAgent", () => {
  it("returns assistant text when no tools", async () => {
    const d = deps({
      complete: async () => ({ content: "早。昨天还剩 2 件。", tool_calls: [] }),
    });
    const r = await runAgent({ deps: d, mode: "morning", userText: "开始今天。", history: [], model: "deepseek-v4-flash" });
    expect(r.assistantText).toContain("早。");
    expect(r.stopped).toBe(false);
  });

  it("propose_todos 确认后经 addTodos 落库，字段全带上", async () => {
    debugLog.clear();
    const added: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "propose_todos",
                  arguments: JSON.stringify({
                    items: [
                      { title: "写脚本", project: "AI视频", estimate: 60, priority: "high", due: "2026-09-10", reason: "先做内容" },
                      { title: "生成画面", project: "AI视频" },
                    ],
                  }),
                },
              },
            ],
          };
        }
        return { content: "已提议，等你确认。", tool_calls: [] };
      },
      addTodos: async (items) => {
        added.push(...items.map((i) => `${i.title}|${i.project}|${i.estimate}|${i.priority}|${i.due}|${i.reason}`));
      },
    });
    const r = await runAgent({
      deps: d,
      mode: "chat",
      userText: "拆成两步：先写脚本，再生成画面",
      history: [
        { id: "u0", role: "user", content: "我要做一个AI视频", createdAt: "2026-09-05T01:00:00.000Z", mode: "chat" },
        { id: "a0", role: "assistant", content: "这摊事要拆成哪几步？", createdAt: "2026-09-05T01:00:01.000Z", mode: "chat" },
      ],
      model: "deepseek-v4-flash",
    });
    expect(added).toEqual(["写脚本|AI视频|60|high|2026-09-10|先做内容", "生成画面|AI视频|undefined|undefined|undefined|undefined"]);
    const result = debugLog.entries.find((e) => e.event === "tool_result" && e.tool === "propose_todos");
    expect(result?.detail).toContain("用户已确认记下：写脚本、生成画面");
    expect(r.assistantText).toBe("已提议，等你确认。");
  });

  it("引导问带 propose_todos 时丢掉全部工具，问句即本轮回复", async () => {
    debugLog.clear();
    const added: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        return {
          content: "这摊事要拆成哪几步？",
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "propose_todos",
                arguments: JSON.stringify({ items: [{ title: "写脚本", project: "视频" }] }),
              },
            },
          ],
        };
      },
      addTodos: async (items) => {
        added.push(...items.map((i) => i.title));
      },
    });
    const r = await runAgent({
      deps: d,
      mode: "chat",
      userText: "我要做一个AI视频",
      history: [],
      model: "deepseek-v4-flash",
    });
    expect(calls).toBe(1);
    expect(added).toEqual([]);
    expect(r.assistantText).toContain("哪几步");
    expect(r.executedPropose).toBe(false);
    expect(r.stopped).toBe(false);
    expect(debugLog.entries.some((e) => e.event === "tool_call")).toBe(false);
  });

  it("空正文加 propose_todos 仍执行（用框来问）", async () => {
    const added: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "propose_todos", arguments: JSON.stringify({ items: [{ title: "买牛奶" }] }) },
              },
            ],
          };
        }
        return { content: "记下了。", tool_calls: [] };
      },
      addTodos: async (items) => {
        added.push(...items.map((i) => i.title));
      },
    });
    const r = await runAgent({ deps: d, mode: "chat", userText: "记得买牛奶", history: [], model: "deepseek-v4-flash" });
    expect(added).toEqual(["买牛奶"]);
    expect(r.executedPropose).toBe(true);
  });

  it("propose_todos 剥掉窗口里没点名的 project", async () => {
    const got: { title: string; project?: string }[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "propose_todos",
                  arguments: JSON.stringify({ items: [{ title: "买瓷砖", project: "装修" }] }),
                },
              },
            ],
          };
        }
        return { content: "记下了。", tool_calls: [] };
      },
      addTodos: async (items) => {
        got.push(...items.map((i) => ({ title: i.title, project: i.project })));
      },
    });
    await runAgent({ deps: d, mode: "chat", userText: "买瓷砖", history: [], model: "deepseek-v4-flash" });
    expect(got).toEqual([{ title: "买瓷砖", project: undefined }]);
  });

  it("propose_todos 被拒绝时不落库", async () => {
    const added: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "propose_todos", arguments: JSON.stringify({ items: [{ title: "给房东转水电费" }] }) },
              },
            ],
          };
        }
        return { content: "好，那先不记。", tool_calls: [] };
      },
      onPropose: async () => [],
      addTodos: async (items) => {
        added.push(...items.map((i) => i.title));
      },
    });
    await runAgent({ deps: d, mode: "chat", userText: "还要给房东转水电费", history: [], model: "deepseek-v4-flash" });
    expect(added).toEqual([]);
  });

  it("propose_todos 跳过与现有待办重复的标题", async () => {
    debugLog.clear();
    let calls = 0;
    const d = deps({
      listTodos: async (): Promise<Todo[]> => [
        { id: "1", title: "给房东转水电费", status: "open", sourceDate: "2026-09-05", createdAt: "2026-09-05T01:00:00.000Z" },
      ],
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "propose_todos", arguments: JSON.stringify({ items: [{ title: "给房东转水电费" }] }) },
              },
            ],
          };
        }
        return { content: "已经有了。", tool_calls: [] };
      },
    });
    const r = await runAgent({ deps: d, mode: "chat", userText: "记一下给房东转水电费", history: [], model: "deepseek-v4-flash" });
    const result = debugLog.entries.find((e) => e.event === "tool_result" && e.tool === "propose_todos");
    expect(result?.detail).toContain("已经有了");
    expect(r.stopped).toBe(false);
  });

  it("propose_todos 跳过被未完成标题包含的新说法", async () => {
    debugLog.clear();
    let proposed = 0;
    const d = deps({
      listTodos: async (): Promise<Todo[]> => [
        { id: "1", title: "摸清第一条链路", status: "open", sourceDate: "2026-09-05", createdAt: "2026-09-05T01:00:00.000Z", when: "later" },
      ],
      onPropose: async () => {
        proposed += 1;
        return [];
      },
      complete: async (): Promise<ChatCompletionResponse> => {
        if (proposed === 0 && debugLog.entries.some((e) => e.event === "tool_call")) {
          return { content: "已经有了。", tool_calls: [] };
        }
        return {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "propose_todos",
                arguments: JSON.stringify({ items: [{ title: "摸清第一条链路：夸克网盘取素材" }] }),
              },
            },
          ],
        };
      },
    });
    await runAgent({ deps: d, mode: "chat", userText: "第一条是夸克取素材", history: [], model: "deepseek-v4-flash" });
    const result = debugLog.entries.find((e) => e.event === "tool_result" && e.tool === "propose_todos");
    expect(result?.detail).toContain("已经有了");
    expect(proposed).toBe(0);
    const dropped = debugLog.entries.find((e) => e.event === "dedupe" && e.tool === "propose_todos");
    expect(dropped?.detail).toContain("摸清第一条链路：夸克网盘取素材");
  });

  it("stops after MAX_MODEL_CALLS", async () => {
    const d = deps({
      complete: async () => ({
        content: null,
        tool_calls: [
          {
            id: "x",
            type: "function",
            function: { name: "list_todos", arguments: "{}" },
          },
        ],
      }),
    });
    const r = await runAgent({ deps: d, mode: "chat", userText: "hi", history: [], model: "deepseek-v4-flash" });
    expect(r.stopped).toBe(true);
    expect(r.assistantText).toContain("这轮没做成");
  });

  it("does not persist a diary when the model names write_daily_log", async () => {
    debugLog.clear();
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => ({
        content: null,
        tool_calls: [
          {
            id: "w",
            type: "function",
            function: {
              name: "write_daily_log",
              arguments: JSON.stringify({
                plan: "先调试",
                done: [],
                undone: [],
                state: "还行",
              }),
            },
          },
        ],
      }),
    });
    const r = await runAgent({
      deps: d,
      mode: "evening",
      userText: "自动整理。",
      history: [],
      model: "deepseek-v4-flash",
      planConfirmed: true,
    });
    expect(r.stopped).toBe(true);
  });

  it("set_today_plan waits for confirm then replaces today's set", async () => {
    const planned: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "s",
                type: "function",
                function: {
                  name: "set_today_plan",
                  arguments: JSON.stringify({
                    items: [{ title: "支付宝" }, { title: "给房东转水电费" }],
                  }),
                },
              },
            ],
          };
        }
        return { content: "今日计划定了。", tool_calls: [] };
      },
      onPropose: async (items, kind) => {
        expect(kind).toBe("today");
        return items;
      },
      setTodayPlan: async (items) => {
        planned.push(...items.map((i) => i.title));
      },
    });
    await runAgent({ deps: d, mode: "morning", userText: "自动整理。", history: [], model: "deepseek-v4-flash" });
    expect(planned).toEqual(["支付宝", "给房东转水电费"]);
  });

  it("set_today_plan still runs after a plan was already confirmed", async () => {
    const planned: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "s",
                type: "function",
                function: {
                  name: "set_today_plan",
                  arguments: JSON.stringify({ items: [{ title: "支付宝" }] }),
                },
              },
            ],
          };
        }
        return { content: "今日计划刷新了。", tool_calls: [] };
      },
      setTodayPlan: async (items) => {
        planned.push(...items.map((i) => i.title));
      },
    });
    await runAgent({
      deps: d,
      mode: "morning",
      userText: "自动整理。",
      history: [],
      model: "deepseek-v4-flash",
      planConfirmed: true,
    });
    expect(planned).toEqual(["支付宝"]);
  });

  it("puts yesterday's diary into the context facts when provided", async () => {
    let seen: ChatCompletionRequest | undefined;
    const d = deps({
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        seen = req;
        return { content: "早。", tool_calls: [] };
      },
    });
    await runAgent({
      deps: d,
      mode: "morning",
      userText: "开始今天",
      history: [],
      model: "deepseek-v4-flash",
      yesterdayLog: {
        date: "2026-09-04",
        state: "显示器买好了，给房东转水电费还拖着",
        updatedAt: "2026-09-04T13:00:00.000Z",
      },
    });
    const facts =
      seen?.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n") ?? "";
    expect(facts).toContain("昨天的日记");
    expect(facts).toContain("给房东转水电费还拖着");
  });

  it("list_todos reports all open items and only todos completed today", async () => {
    debugLog.clear();
    let calls = 0;
    const d = deps({
      listTodos: async (): Promise<Todo[]> => [
        {
          id: "1",
          title: "昨天留下",
          status: "open",
          sourceDate: "2026-09-04",
          createdAt: "2026-09-04T01:00:00.000Z",
        },
        {
          id: "2",
          title: "今天的事",
          status: "open",
          sourceDate: "2026-09-05",
          createdAt: "2026-09-05T01:00:00.000Z",
        },
        {
          id: "3",
          title: "今天勾掉",
          status: "done",
          sourceDate: "2026-09-05",
          createdAt: "2026-09-05T01:00:00.000Z",
          completedAt: new Date(2026, 8, 5, 10, 0, 0).toISOString(),
        },
        {
          id: "4",
          title: "昨天勾掉",
          status: "done",
          sourceDate: "2026-09-04",
          createdAt: "2026-09-04T01:00:00.000Z",
          completedAt: new Date(2026, 8, 4, 10, 0, 0).toISOString(),
        },
        {
          id: "5",
          title: "修车",
          status: "open",
          sourceDate: "2026-09-05",
          createdAt: "2026-09-05T01:00:00.000Z",
          when: "later",
        },
      ],
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "l",
                type: "function",
                function: { name: "list_todos", arguments: "{}" },
              },
            ],
          };
        }
        return { content: "看过了。", tool_calls: [] };
      },
    });
    await runAgent({ deps: d, mode: "chat", userText: "还有什么", history: [], model: "deepseek-v4-flash" });
    const result = debugLog.entries.find((e) => e.event === "tool_result" && e.tool === "list_todos");
    expect(result?.detail).toContain("昨天留下");
    expect(result?.detail).toContain("今天的事");
    expect(result?.detail).toContain("修车");
    expect(result?.detail).toContain("今天勾掉");
    expect(result?.detail).not.toContain("昨天勾掉");
    expect(result?.detail).toContain("今天 2 件");
    expect(result?.detail).toContain("以后 1 件");
    expect(result?.detail).toContain("今日已完成 1 件");
  });

  it("有 completeStream 时回复走流式，onReplyDelta 收到累积全文", async () => {
    const deltas: string[] = [];
    const d = deps({
      complete: async () => {
        throw new Error("不该走非流式");
      },
      completeStream: async (_req, onText) => {
        onText("早");
        onText("早。昨天还剩 2 件。");
        return { content: "早。昨天还剩 2 件。", tool_calls: [] };
      },
    });
    const r = await runAgent({
      deps: d,
      mode: "chat",
      userText: "开始今天。",
      history: [],
      model: "deepseek-v4-flash",
      onReplyDelta: (t) => deltas.push(t),
    });
    expect(deltas).toEqual(["早", "早。昨天还剩 2 件。"]);
    expect(r.assistantText).toBe("早。昨天还剩 2 件。");
    expect(r.stopped).toBe(false);
  });

  it("流式的工具轮没有文本：onReplyDelta 不触发，工具照跑，最终消息与非流式一致", async () => {
    const deltas: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async () => {
        throw new Error("不该走非流式");
      },
      completeStream: async (_req, onText): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [{ id: "l", type: "function", function: { name: "list_todos", arguments: "{}" } }],
          };
        }
        onText("看过了。");
        return { content: "看过了。", tool_calls: [] };
      },
    });
    const r = await runAgent({
      deps: d,
      mode: "chat",
      userText: "还有什么",
      history: [],
      model: "deepseek-v4-flash",
      onReplyDelta: (t) => deltas.push(t),
    });
    expect(calls).toBe(2);
    expect(deltas).toEqual(["看过了。"]);
    expect(r.assistantText).toBe("看过了。");
  });

  it("没有 completeStream 时走非流式老路，onReplyDelta 不触发", async () => {
    const deltas: string[] = [];
    const d = deps({
      complete: async () => ({ content: "早。", tool_calls: [] }),
    });
    const r = await runAgent({
      deps: d,
      mode: "morning",
      userText: "开始今天。",
      history: [],
      model: "deepseek-v4-flash",
      onReplyDelta: (t) => deltas.push(t),
    });
    expect(deltas).toEqual([]);
    expect(r.assistantText).toBe("早。");
  });

  it("工具 arguments 非 JSON 返回参数无效，不落库", async () => {
    debugLog.clear();
    const added: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "propose_todos", arguments: "not-json" },
              },
            ],
          };
        }
        return { content: "再说一次。", tool_calls: [] };
      },
      addTodos: async (items) => {
        added.push(...items.map((i) => i.title));
      },
    });
    await runAgent({ deps: d, mode: "chat", userText: "记一下买牛奶", history: [], model: "deepseek-v4-flash" });
    const result = debugLog.entries.find((e) => e.event === "tool_result" && e.tool === "propose_todos");
    expect(result?.detail).toBe("参数无效");
    expect(added).toEqual([]);
  });

  it("set_today_plan 全空标题 → 没有可定的今日事项", async () => {
    debugLog.clear();
    const planned: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "s",
                type: "function",
                function: {
                  name: "set_today_plan",
                  arguments: JSON.stringify({ items: [{ title: "  " }] }),
                },
              },
            ],
          };
        }
        return { content: "先不定。", tool_calls: [] };
      },
      setTodayPlan: async (items) => {
        planned.push(...items.map((i) => i.title));
      },
    });
    await runAgent({ deps: d, mode: "morning", userText: "自动整理。", history: [], model: "deepseek-v4-flash" });
    const result = debugLog.entries.find((e) => e.event === "tool_result" && e.tool === "set_today_plan");
    expect(result?.detail).toBe("没有可定的今日事项");
    expect(planned).toEqual([]);
  });
});
