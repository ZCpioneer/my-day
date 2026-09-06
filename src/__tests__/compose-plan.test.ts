import { describe, it, expect } from "vitest";
import { composePlan } from "@/agent/compose-plan";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import type { Todo } from "@/types";

const todos: Todo[] = [
  {
    id: "1",
    title: "周报",
    status: "open",
    sourceDate: "2026-09-05",
    createdAt: "2026-09-05T01:00:00.000Z",
    when: "later",
  },
  {
    id: "2",
    title: "水电费",
    status: "open",
    sourceDate: "2026-09-05",
    createdAt: "2026-09-05T01:00:00.000Z",
    when: "today",
  },
];

describe("composePlan", () => {
  it("returns today and later from JSON and does not use chat tools", async () => {
    const plan = await composePlan({
      date: "2026-09-05",
      chat: {
        date: "2026-09-05",
        messages: [
          {
            id: "m1",
            role: "user",
            content: "支付宝必须今天弄完，机票以后再买",
            createdAt: "2026-09-05T01:00:00.000Z",
          },
        ],
      },
      todos,
      projects: [],
      model: "deepseek-v4-flash",
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        expect(req.tools).toEqual([]);
        const packed = JSON.stringify(req.messages);
        expect(packed).toContain("支付宝必须今天弄完");
        expect(packed).toContain("水电费");
        expect(packed).toContain("周报");
        expect(packed).toContain("以后");
        return {
          content: '{"today":[{"title":"支付宝"}],"later":[{"title":"周报"},{"title":"买机票"}]}',
          tool_calls: [],
        };
      },
    });
    expect(plan.today.map((i) => i.title)).toEqual(["支付宝"]);
    expect(plan.later.map((i) => i.title)).toEqual(["周报", "买机票"]);
  });

  it("falls back to current buckets when the model returns empty lists", async () => {
    const plan = await composePlan({
      date: "2026-09-05",
      chat: { date: "2026-09-05", messages: [] },
      todos,
      projects: [],
      model: "deepseek-v4-flash",
      complete: async () => ({ content: '{"today":[],"later":[]}', tool_calls: [] }),
    });
    expect(plan.today.map((i) => i.title)).toEqual(["水电费"]);
    expect(plan.later.map((i) => i.title)).toEqual(["周报"]);
  });

  it("throws when the model returns unusable content", async () => {
    await expect(
      composePlan({
        date: "2026-09-05",
        chat: { date: "2026-09-05", messages: [] },
        todos,
        projects: [],
        model: "deepseek-v4-flash",
        complete: async () => ({ content: "今天先聊两句。", tool_calls: [] }),
      }),
    ).rejects.toThrow("待办这轮没整理成");
  });

  it("提示词带现有项目；模型输出和兜底都保留 project 字段", async () => {
    const grouped: Todo[] = [
      { ...todos[0], projectId: "p1" },
    ];
    const projects = [
      { id: "p1", title: "搬家", status: "active" as const, createdAt: "2026-09-05T01:00:00.000Z", updatedAt: "2026-09-05T01:00:00.000Z" },
    ];
    const plan = await composePlan({
      date: "2026-09-05",
      chat: { date: "2026-09-05", messages: [] },
      todos: grouped,
      projects,
      model: "deepseek-v4-flash",
      complete: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        expect(JSON.stringify(req.messages)).toContain("搬家");
        return {
          content: '{"today":[],"later":[{"title":"打包","project":"搬家"}]}',
          tool_calls: [],
        };
      },
    });
    // 模型给的组名透传
    expect(plan.later.find((i) => i.title === "打包")?.project).toBe("搬家");
    // 兜底补回的现有 later 任务带上自己的组名
    expect(plan.later.find((i) => i.title === "周报")?.project).toBe("搬家");
  });
});
