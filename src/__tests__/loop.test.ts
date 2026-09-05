import { describe, it, expect } from "vitest";
import { runAgent, MAX_MODEL_CALLS } from "@/agent/loop";
import type { AgentDeps } from "@/agent/loop";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { debugLog } from "@/debug/log";
import type { DailyLog, ProposedTodo, Todo } from "@/types";

function deps(over: Partial<AgentDeps> & { complete: AgentDeps["complete"] }): AgentDeps {
  return {
    listTodos: async () => [],
    addTodos: async () => {},
    writeDailyLog: async () => {},
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

  it("write_daily_log persists one full document", async () => {
    const saved: DailyLog[] = [];
    let calls = 0;
    const d = deps({
      listTodos: async (): Promise<Todo[]> => [
        {
          id: "1",
          title: "周报",
          status: "open",
          sourceDate: "2026-09-04",
          createdAt: "2026-09-04T01:00:00.000Z",
        },
        {
          id: "2",
          title: "支付宝",
          status: "done",
          sourceDate: "2026-09-05",
          createdAt: "2026-09-05T01:00:00.000Z",
          completedAt: new Date(2026, 8, 5, 12, 0, 0).toISOString(),
        },
        {
          id: "3",
          title: "昨天勾掉",
          status: "done",
          sourceDate: "2026-09-04",
          createdAt: "2026-09-04T01:00:00.000Z",
          completedAt: new Date(2026, 8, 4, 12, 0, 0).toISOString(),
        },
      ],
      complete: async (): Promise<ChatCompletionResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "w",
                type: "function",
                function: {
                  name: "write_daily_log",
                  arguments: JSON.stringify({
                    plan: "先调试",
                    done: ["模型瞎写"],
                    undone: ["也是假的"],
                    state: "下午有点烦",
                  }),
                },
              },
            ],
          };
        }
        return { content: "日记写下了。", tool_calls: [] };
      },
      writeDailyLog: async (log) => {
        saved.push(log);
      },
    });
    await runAgent({ deps: d, mode: "evening", userText: "今天结束了。", history: [], model: "deepseek-v4-flash" });
    expect(saved).toHaveLength(1);
    expect(saved[0].plan).toBe("先调试");
    expect(saved[0].state).toBe("下午有点烦");
    expect(saved[0].done).toEqual(["支付宝"]);
    expect(saved[0].undone).toEqual(["周报"]);
    expect(saved[0].date).toBe("2026-09-05");
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
    expect(result?.detail).toContain("昨天留下（跨天）");
    expect(result?.detail).toContain("今天的事");
    expect(result?.detail).toContain("今天勾掉");
    expect(result?.detail).not.toContain("昨天勾掉");
    expect(result?.detail).toContain("未完成 2 件");
    expect(result?.detail).toContain("已完成 1 件");
  });
});
