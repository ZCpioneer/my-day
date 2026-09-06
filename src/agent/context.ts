import type { ApiMessage } from "@/api/deepseek";
import type { ChatMessage, ChatMode, DailyLog, Todo } from "@/types";

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

function formatYesterdayLog(log: DailyLog): string {
  const done = log.done.length ? log.done.join("；") : "无";
  const undone = log.undone.length ? log.undone.join("；") : "无";
  return `昨天的日记：计划「${log.plan}」；做成了：${done}；没做完：${undone}；状态：${log.state}。`;
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
  yesterdayLog?: DailyLog | null;
}): ApiMessage[] {
  const facts = [
    `今天是 ${input.date}，${input.timeLabel}。当前模式：${modeLabel(input.mode)}。`,
    input.planConfirmed ? "今天已经确认过今日计划。" : "今天还没有确认过今日计划。",
    input.yesterdayLog ? formatYesterdayLog(input.yesterdayLog) : "",
    formatBucket("今天", input.todayTodos),
    formatBucket("以后", input.laterTodos),
    formatBucket("今日已完成", input.doneToday),
    "待办列表是唯一真相。有没有完成，只看上面的分区，不要根据聊天记录判断。以后不算没做完。",
  ].join("");
  const history: ApiMessage[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [{ role: "system", content: facts }, ...history];
}
