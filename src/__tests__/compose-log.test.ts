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

  it("日记只保留状态与寄语：模型写 state，不再单列计划/做了/没做", async () => {
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
        return { content: '{"state":"支付宝搞定了，周报还拖着，有点累"}', tool_calls: [] };
      },
    });
    expect(log.date).toBe("2026-09-04");
    expect(log.state).toBe("支付宝搞定了，周报还拖着，有点累");
    expect(log).not.toHaveProperty("plan");
    expect(log).not.toHaveProperty("done");
    expect(log).not.toHaveProperty("undone");
  });

  it("feeds archived session text to the diary model after the thread was cleared", async () => {
    await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: {
        date: "2026-09-04",
        messages: [],
        archive: [
          {
            id: "a1",
            role: "user",
            content: "早上说先做支付宝",
            createdAt: "2026-09-04T01:00:00.000Z",
          },
        ],
        planConfirmedAt: "2026-09-04T02:00:00.000Z",
      },
      todos,
      model: "deepseek-v4-flash",
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        expect(JSON.stringify(req.messages)).toContain("早上说先做支付宝");
        return { content: '{"state":"还行"}', tool_calls: [] };
      },
    });
  });

  it("把今日计划逐项的做了/没做喂给模型写复盘", async () => {
    await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: { date: "2026-09-04", messages: [] },
      todos,
      model: "deepseek-v4-flash",
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        const body = JSON.stringify(req.messages);
        expect(body).toContain("今日计划对照");
        expect(body).toContain("支付宝（做了）");
        expect(body).toContain("周报（没做）");
        return { content: '{"state":"立的做了大半"}', tool_calls: [] };
      },
    });
  });

  it("reads JSON even when wrapped in a fence", async () => {
    const log = await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: { date: "2026-09-04", messages: [] },
      todos,
      model: "deepseek-v4-flash",
      complete: async () => ({
        content: "```json\n{\"state\":\"只勾了几件\"}\n```",
        tool_calls: [],
      }),
    });
    expect(log.state).toBe("只勾了几件");
  });

  it("模型给了 mood/cheer 就带上，没给不挡落库", async () => {
    const withMood = await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: { date: "2026-09-04", messages: [] },
      todos,
      model: "deepseek-v4-flash",
      complete: async () => ({
        content: '{"state":"有点累","mood":"😮‍💨","cheer":"今天推进了不少，早点休息。"}',
        tool_calls: [],
      }),
    });
    expect(withMood.mood).toBe("😮‍💨");
    expect(withMood.cheer).toBe("今天推进了不少，早点休息。");

    const without = await composeDailyLog({
      date: "2026-09-04",
      now: new Date(2026, 8, 5, 8, 0, 0),
      chat: { date: "2026-09-04", messages: [] },
      todos,
      model: "deepseek-v4-flash",
      complete: async () => ({ content: '{"state":"有点累","mood":"  "}', tool_calls: [] }),
    });
    expect(without.mood).toBeUndefined();
    expect(without.cheer).toBeUndefined();
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
