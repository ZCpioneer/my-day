import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { sessionTranscript } from "@/chat-session";
import { partitionTodos } from "@/todos";
import { filterPlanItems } from "@/todos-filter";
import type { DayChat, Project, ProposedTodo, Todo } from "@/types";
import { formatBucket } from "./context";
import { parseJsonObject } from "./parse-json";
import { tidyPlanPrompt } from "./prompt";

function asTitles(todos: Todo[], when: "today" | "later", projects: Project[]): ProposedTodo[] {
  const titles = new Map(projects.map((p) => [p.id, p.title]));
  return todos.map((t) => ({
    title: t.title,
    when,
    project: t.projectId ? titles.get(t.projectId) : undefined,
  }));
}

export async function composePlan(input: {
  date: string;
  chat: DayChat;
  todos: Todo[];
  projects: Project[];
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
  model: string;
}): Promise<{ today: ProposedTodo[]; later: ProposedTodo[] }> {
  const { today, later, doneToday } = partitionTodos(input.todos, input.date);
  const activeProjects = input.projects.filter((p) => p.status !== "done");
  const facts = [
    `日期：${input.date}`,
    input.chat.planConfirmedAt ? "今天已经确认过今日计划，这次是刷新全部待办。" : "今天还没有确认过今日计划。",
    formatBucket("今天", today, input.date),
    formatBucket("以后", later, input.date),
    formatBucket("今日已完成", doneToday, input.date),
    `现有项目（组）：${activeProjects.length > 0 ? activeProjects.map((p) => p.title).join("、") : "无"}。`,
    "请把今天、以后、以及这段对话里的事合在一起重新排。today 宜少，其余进 later。",
    "当前这段对话：",
    sessionTranscript(input.chat.messages),
  ].join("\n");

  const res = await input.complete({
    model: input.model,
    messages: [
      { role: "system", content: tidyPlanPrompt() },
      { role: "user", content: facts },
    ],
    tools: [],
    stream: false,
  });
  const parsed = typeof res.content === "string" ? parseJsonObject(res.content) : undefined;
  if (!parsed || typeof parsed !== "object") throw new Error("待办这轮没整理成");
  const parsedPlan = filterPlanItems(parsed);
  return filterPlanItems({
    today: parsedPlan.today.length ? parsedPlan.today : asTitles(today, "today", input.projects),
    later: [...parsedPlan.later, ...asTitles(later, "later", input.projects)],
  });
}
