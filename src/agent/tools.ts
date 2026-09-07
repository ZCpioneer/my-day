import type { ToolDef } from "@/api/deepseek";

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_todos",
      description: "读取当前待办：今天、以后、今日已完成。没有勾掉任务的能力。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_today_plan",
      description: "提议今天做哪几件。可以是已有标题或新标题。用户确认后才会刷新今天的清单，当前这段对话也会结束并清空；没选上的今天事项掉回以后。",
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
      name: "propose_todos",
      description: "把对话里谈好的事提议成待办（一条或多条，进「以后」）。用户确认后才会写入。解析层已弹过确认框的事不要重复提议。",
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
                priority: { type: "string", enum: ["high", "normal"] },
                due: { type: "string", description: "ISO 日期，如 2026-09-07；只有谈清楚时才给" },
                estimate: { type: "number", description: "预估耗时，分钟；只有谈清楚时才给" },
                project: { type: "string", description: "归属哪摊事（项目名），优先用现有项目" },
              },
              required: ["title"],
            },
          },
        },
        required: ["items"],
      },
    },
  },
];
