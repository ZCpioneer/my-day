import type { ApiMessage } from "@/api/deepseek";
import type { ChatMessage, ChatMode, Todo } from "@/types";

const RECENT_MESSAGES = 16;

function modeLabel(mode: ChatMode): string {
  if (mode === "chat") return "闲聊";
  return "整理今日待办";
}

function titles(todos: Todo[]): string {
  return todos.map((t) => t.title).join("；");
}

function formatBucket(label: string, todos: Todo[]): string {
  if (todos.length === 0) return `${label} 0 件。`;
  return `${label} ${todos.length} 件：${titles(todos)}。`;
}

export function buildContextMessages(input: {
  date: string;
  timeLabel: string;
  mode: ChatMode;
  todayTodos: Todo[];
  laterTodos: Todo[];
  doneToday: Todo[];
  messages: ChatMessage[];
  planConfirmed: boolean;
}): ApiMessage[] {
  const facts = [
    `今天是 ${input.date}，${input.timeLabel}。当前模式：${modeLabel(input.mode)}。`,
    input.planConfirmed ? "今天已经确认过今日计划。" : "今天还没有确认过今日计划。",
    formatBucket("今天", input.todayTodos),
    formatBucket("以后", input.laterTodos),
    formatBucket("今日已完成", input.doneToday),
    "待办列表是唯一真相。有没有完成，只看上面的分区，不要根据聊天记录判断。以后不算没做完。",
  ].join("");
  const history: ApiMessage[] = input.messages.slice(-RECENT_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [{ role: "system", content: facts }, ...history];
}
