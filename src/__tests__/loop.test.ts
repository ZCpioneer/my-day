import { describe, it, expect } from "vitest";
import { runAgent, MAX_MODEL_CALLS } from "@/agent/loop";
import type { AgentDeps } from "@/agent/loop";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { debugLog } from "@/debug/log";
import type { ProposedTodo, Todo } from "@/types";

function deps(over: Partial<AgentDeps> & { complete: AgentDeps["complete"] }): AgentDeps {
  return {
    listTodos: async () => [],
    addTodos: async () => {},
    setTodayPlan: async () => {},
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

  it("does not write todos until onPropose returns them", async () => {
    const added: string[] = [];
    let calls = 0;
    const d = deps({
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
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
                  arguments: JSON.stringify({ items: [{ title: "给房东转水电费" }] }),
                },
              },
            ],
          };
        }
        return { content: "已记下要加的。", tool_calls: [] };
      },
      onPropose: async () => [] as ProposedTodo[],
      addTodos: async (items) => {
        added.push(...items.map((i) => i.title));
      },
    });
    const r = await runAgent({ deps: d, mode: "chat", userText: "还要给房东转水电费", history: [], model: "deepseek-v4-flash" });
    expect(added).toEqual([]);
    expect(r.assistantText.length).toBeGreaterThan(0);
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
    expect(debugLog.entries.find((e) => e.event === "log_written")).toBeUndefined();
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
        plan: "买显示器",
        done: ["买显示器"],
        undone: ["给房东转水电费"],
        state: "还行",
        updatedAt: "2026-09-04T13:00:00.000Z",
      },
    });
    const facts =
      seen?.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n") ?? "";
    expect(facts).toContain("昨天的日记");
    expect(facts).toContain("给房东转水电费");
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
});
