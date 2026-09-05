export type ChatMode = "morning" | "evening" | "chat";
export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  mode?: ChatMode;
}

export interface DayChat {
  date: string;
  messages: ChatMessage[];
}

export interface Todo {
  id: string;
  title: string;
  status: "open" | "done";
  sourceDate: string;
  createdAt: string;
  completedAt?: string;
  fromMessageId?: string;
}

export interface DailyLog {
  date: string;
  plan: string;
  done: string[];
  undone: string[];
  state: string;
  updatedAt: string;
}

export interface Settings {
  apiKey: string;
  model: string;
  debugOverlay: boolean;
  /** 0–23. Hours before this are 朝; this hour and after are 暮. */
  daySplitHour: number;
}

export type DebugEvent =
  | "http_start"
  | "http_ok"
  | "http_fail"
  | "tool_call"
  | "tool_result"
  | "propose_ui"
  | "todo_confirmed"
  | "todo_rejected"
  | "log_written"
  | "agent_stop";

export interface DebugEntry {
  id: string;
  time: string;
  event: DebugEvent;
  detail: string;
  status?: number;
  durationMs?: number;
  model?: string;
  tool?: string;
}

export interface ProposedTodo {
  title: string;
  reason?: string;
}

export const DEFAULT_MODEL = "deepseek-v4-flash";
