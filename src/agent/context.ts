import type { ApiMessage } from "@/api/deepseek";
import type { ChatMessage, ChatMode, Todo } from "@/types";

const RECENT_MESSAGES = 16;
const MAX_MESSAGES = 40;

function isRitual(m: ChatMessage): boolean {
  return m.mode === "morning" || m.mode === "evening";
}

function selectHistory(messages: ChatMessage[]): ChatMessage[] {
  const n = messages.length;
  const keep = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (isRitual(messages[i])) keep.add(i);
  }
  for (let i = Math.max(0, n - RECENT_MESSAGES); i < n; i++) keep.add(i);
  let selected = messages.filter((_, i) => keep.has(i));
  if (selected.length > MAX_MESSAGES) {
    let extra = selected.length - MAX_MESSAGES;
    selected = selected.filter((m) => {
      if (!isRitual(m) && extra > 0) {
        extra--;
        return false;
      }
      return true;
    });
  }
  return selected;
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
  ].join("");
  const history: ApiMessage[] = selectHistory(input.messages).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [{ role: "system", content: facts }, ...history];
}
