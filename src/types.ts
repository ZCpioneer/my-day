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
  /** Closed sessions, oldest first. Diary still reads these after the thread is cleared. */
  archive?: ChatMessage[];
  planConfirmedAt?: string;
}

export interface Todo {
  id: string;
  title: string;
  status: "open" | "done";
  sourceDate: string;
  createdAt: string;
  completedAt?: string;
  fromMessageId?: string;
  /** Missing means today, so old rows stay on today's list. */
  when?: "today" | "later";
  /** 桶内手动排位；缺失时按 createdAt 兜底（兼容旧数据）。 */
  order?: number;
  /** 缺失 = normal（兼容旧数据）。 */
  priority?: "high" | "normal";
  /** ISO 日期或日期时间，可选。 */
  due?: string;
  /** 关联项目 id，可选。 */
  projectId?: string;
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
  | "agent_stop"
  | "parse_fail";

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
  when?: "today" | "later";
  priority?: "high" | "normal";
  due?: string;
  /** 项目标题，落库时解析成 projectId。 */
  project?: string;
  /** 确认框上的展示标签（如记忆类别），不落库。 */
  tag?: string;
}

export interface TimelineEvent {
  id: string;
  /** 本地日历日。 */
  date: string;
  createdAt: string;
  kind: "event" | "decision";
  /** 一句事实。 */
  text: string;
  fromMessageId: string;
}

export interface Project {
  id: string;
  title: string;
  status: "active" | "done" | "paused";
  /** 最近进展。 */
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Waiting {
  id: string;
  /** 在等什么。 */
  text: string;
  /** 等谁/等什么条件。 */
  waitingOn?: string;
  since: string;
  /** 有值 = 已解决。 */
  resolvedAt?: string;
  fromMessageId: string;
}

export interface Memory {
  id: string;
  text: string;
  kind: "preference" | "goal" | "watch";
  createdAt: string;
}

export const MEMORY_KIND_LABEL: Record<Memory["kind"], string> = {
  preference: "偏好",
  goal: "目标",
  watch: "关注",
};

export interface ParsedTask {
  title: string;
  reason?: string;
  priority?: "high" | "normal";
  due?: string;
  /** 项目标题，优先从现有项目里选。 */
  project?: string;
}

export interface ProjectUpdate {
  project: string;
  note: string;
  status?: "active" | "done" | "paused";
}

export interface ParsedWaiting {
  text: string;
  waitingOn?: string;
}

export interface MemoryCandidate {
  text: string;
  kind: "preference" | "goal" | "watch";
}

/** 解析层对一条用户输入的结构化产出；六类全空 = 纯闲聊。 */
export interface ParseResult {
  events: string[];
  decisions: string[];
  tasks: ParsedTask[];
  projectUpdates: ProjectUpdate[];
  waitings: ParsedWaiting[];
  waitingsResolved: string[];
  memories: MemoryCandidate[];
}

export const DEFAULT_MODEL = "deepseek-v4-flash";
