import type { ApiMessage } from "@/api/deepseek";
import { sessionMessages } from "@/ritual";
import type { ChatMessage, ChatMode, Todo } from "@/types";

const RECENT_MESSAGES = 16;

function selectHistory(messages: ChatMessage[], mode: ChatMode): ChatMessage[] {
  const mine = sessionMessages(messages, mode);
  return mine.slice(-RECENT_MESSAGES);
}

function modeLabel(mode: ChatMode): string {
  if (mode === "morning") return "朝";
  if (mode === "evening") return "暮";
  return "闲聊";
}

function formatOpen(todos: Todo[], date: string): string {
  if (todos.length === 0) return "未完成 0 件。";
  const titles = todos
    .map((t) => (t.sourceDate !== date ? `${t.title}（跨天）` : t.title))
    .join("；");
  return `未完成 ${todos.length} 件：${titles}。`;
}

function formatDone(todos: Todo[]): string {
  if (todos.length === 0) return "今日已完成 0 件。";
  return `今日已完成 ${todos.length} 件：${todos.map((t) => t.title).join("；")}。`;
}

export function buildContextMessages(input: {
  date: string;
  timeLabel: string;
  mode: ChatMode;
  openTodos: Todo[];
  doneToday: Todo[];
  messages: ChatMessage[];
}): ApiMessage[] {
  const facts = [
    `今天是 ${input.date}，${input.timeLabel}。当前模式：${modeLabel(input.mode)}。`,
    formatOpen(input.openTodos, input.date),
    formatDone(input.doneToday),
    "待办列表是唯一真相。有没有完成，只看上面的未完成/已完成，不要根据聊天记录判断。",
  ].join("");
  const history: ApiMessage[] = selectHistory(input.messages, input.mode).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [{ role: "system", content: facts }, ...history];
}
