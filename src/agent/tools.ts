import type { ToolDef } from "@/api/deepseek";

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_todos",
      description: "读取当前待办（未完成与已完成）。没有勾掉任务的能力。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_todos",
      description: "提议新待办。不会直接写入；用户在确认框勾选后才加入。",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                reason: { type: "string" },
              },
              required: ["title"],
            },
          },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_order",
      description: "给未完成项一个建议顺序。只记在对话里，不改待办列表顺序。",
      parameters: {
        type: "object",
        properties: {
          order: { type: "array", items: { type: "string" } },
        },
        required: ["order"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_daily_log",
      description: "按结构写入今日日记（计划、做成了、没做完、状态）。同一天覆盖整篇。",
      parameters: {
        type: "object",
        properties: {
          plan: { type: "string" },
          done: { type: "array", items: { type: "string" } },
          undone: { type: "array", items: { type: "string" } },
          state: { type: "string" },
        },
        required: ["plan", "done", "undone", "state"],
      },
    },
  },
];
