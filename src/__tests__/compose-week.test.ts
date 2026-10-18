import { describe, it, expect } from "vitest";
import { composeWeeklyLog } from "@/agent/compose-week";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import type { DailyLog, Todo } from "@/types";

function mkLog(date: string, state: string): DailyLog {
  return {
    date,
    state,
    updatedAt: `${date}T12:00:00.000Z`,
  };
}

// 本周 = 2026-W37（周一 2026-09-07 到周日 2026-09-13），now 取周中任意一天。
const NOW = new Date(2026, 8, 10, 15, 0, 0);

function mkTodo(partial: Partial<Todo> & { title: string }): Todo {
  return {
    id: partial.title,
    status: "open",
    sourceDate: "2026-09-07",
    createdAt: "2026-09-07T01:00:00.000Z",
    ...partial,
  };
}

describe("composeWeeklyLog", () => {
  it("组装七天日记和本周勾选情况，解析模型 JSON 成周报", async () => {
    const logs = [mkLog("2026-09-07", "周一还行"), mkLog("2026-09-09", "周三挺累")];
    const todos: Todo[] = [
      // 本周勾掉：completedAt 落在本周（用本地时间构造，避免时区抖动）
      mkTodo({ title: "交周报", status: "done", completedAt: new Date(2026, 8, 8, 10, 0, 0).toISOString() }),
      // 上周勾掉的不算本周
      mkTodo({ title: "旧事", status: "done", completedAt: new Date(2026, 7, 31, 10, 0, 0).toISOString() }),
      // 本周立下还没做完
      mkTodo({ title: "写解析层", sourceDate: "2026-09-09" }),
      // 上周立下还开着的：不算「本周立下」
      mkTodo({ title: "老尾巴", sourceDate: "2026-09-01" }),
    ];
    const log = await composeWeeklyLog({
      now: NOW,
      logs,
      todos,
      model: "deepseek-v4-flash",
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        expect(req.tools).toEqual([]);
        const body = JSON.stringify(req.messages);
        expect(body).toContain("2026-W37");
        expect(body).toContain("2026-09-07 到 2026-09-13");
        expect(body).toContain("周一还行");
        expect(body).toContain("周三挺累");
        expect(body).toContain("2026-09-08：没有日记");
        expect(body).toContain("本周勾掉的待办：交周报");
        expect(body).not.toContain("旧事");
        expect(body).toContain("本周立下还没做完的待办：写解析层");
        expect(body).not.toContain("老尾巴");
        return {
          content: '{"done":"做完了解析层联调","undone":"周报还剩一点","next":"下周先收周报"}',
          tool_calls: [],
        };
      },
    });
    expect(log.week).toBe("2026-W37");
    expect(log.from).toBe("2026-09-07");
    expect(log.to).toBe("2026-09-13");
    expect(log.done).toBe("做完了解析层联调");
    expect(log.undone).toBe("周报还剩一点");
    expect(log.next).toBe("下周先收周报");
    expect(log.updatedAt).toBe(NOW.toISOString());
  });

  it("模型没返回可用 JSON 时抛错", async () => {
    await expect(
      composeWeeklyLog({
        now: NOW,
        logs: [],
        todos: [],
        model: "deepseek-v4-flash",
        complete: async () => ({ content: "写不出来", tool_calls: [] }),
      }),
    ).rejects.toThrow("周报这轮没生成");
  });
});
