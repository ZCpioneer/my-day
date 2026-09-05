import { describe, it, expect } from "vitest";
import { runAgent, MAX_MODEL_CALLS } from "@/agent/loop";
import type { AgentDeps } from "@/agent/loop";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import type { ProposedTodo, Todo } from "@/types";

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
    const saved: string[] = [];
    let calls = 0;
    const d = deps({
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
                    done: ["支付宝"],
                    undone: ["周报"],
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
        saved.push(log.state);
      },
    });
    await runAgent({ deps: d, mode: "evening", userText: "今天结束了。", history: [], model: "deepseek-v4-flash" });
    expect(saved).toEqual(["下午有点烦"]);
  });
});
