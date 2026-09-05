import { describe, it, expect } from "vitest";
import { composeDailyLog } from "@/agent/compose-log";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import type { Todo } from "@/types";

describe("composeDailyLog", () => {
  const todos: Todo[] = [
    {
      id: "1",
      title: "周报",
      status: "open",
      sourceDate: "2026-09-04",
      createdAt: "2026-09-04T01:00:00.000Z",
      when: "today",
    },
    {
      id: "2",
      title: "支付宝",
      status: "done",
      sourceDate: "2026-09-04",
      createdAt: "2026-09-04T01:00:00.000Z",
      completedAt: "2026-09-04T12:00:00.000Z",
      when: "today",
    },
  ];

  it("fills plan/state from the model and done/undone from todos for that date", async () => {
    const log = await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: {
        date: "2026-09-04",
        messages: [
          {
            id: "m1",
            role: "user",
            content: "先做支付宝",
            createdAt: "2026-09-04T01:00:00.000Z",
          },
        ],
        planConfirmedAt: "2026-09-04T02:00:00.000Z",
      },
      todos,
      model: "deepseek-v4-flash",
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        expect(req.tools).toEqual([]);
        expect(JSON.stringify(req.messages)).toContain("先做支付宝");
        return { content: '{"plan":"先做支付宝","state":"有点累"}', tool_calls: [] };
      },
    });
    expect(log.date).toBe("2026-09-04");
    expect(log.plan).toBe("先做支付宝");
    expect(log.state).toBe("有点累");
    expect(log.done).toEqual(["支付宝"]);
    expect(log.undone).toEqual(["周报"]);
  });

  it("reads JSON even when wrapped in a fence", async () => {
    const log = await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: { date: "2026-09-04", messages: [] },
      todos,
      model: "deepseek-v4-flash",
      complete: async () => ({
        content: "```json\n{\"plan\":\"没有确认过今日计划\",\"state\":\"只勾了几件\"}\n```",
        tool_calls: [],
      }),
    });
    expect(log.plan).toBe("没有确认过今日计划");
    expect(log.state).toBe("只勾了几件");
  });

  it("throws when the model returns unusable content", async () => {
    await expect(
      composeDailyLog({
        date: "2026-09-04",
        now: new Date(2026, 8, 5, 8, 0, 0),
        chat: { date: "2026-09-04", messages: [] },
        todos,
        model: "deepseek-v4-flash",
        complete: async () => ({ content: "写不出来", tool_calls: [] }),
      }),
    ).rejects.toThrow();
  });
});
