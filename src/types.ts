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
  /** 缺失视为 today。 */
  when?: "today" | "later";
  /** 桶内手动排位；缺失时按 createdAt 兜底。 */
  order?: number;
  /** 缺失 = normal。 */
  priority?: "high" | "normal";
  /** ISO 日期或日期时间，可选。 */
  due?: string;
  /** 关联项目 id，可选。 */
  projectId?: string;
  /** 为什么做，来自解析层，可选。 */
  reason?: string;
  /** 预估耗时（分钟），可选。 */
  estimate?: number;
}

export interface DailyLog {
  date: string;
  /** 当天状态与复盘（计划 vs 完成的对照融在文字里，不单独成段）。 */
  state: string;
  /** 当天整体情绪，单个 emoji；旧日记没有。 */
  mood?: string;
  /** 秘书寄语：一句鼓励或点评；旧日记没有。 */
  cheer?: string;
  updatedAt: string;
}

export interface WeeklyLog {
  /** ISO 周键，如 "2026-W37"（周一为一周开始）。 */
  week: string;
  /** 本周起止本地日历日：from 周一，to 周日。 */
  from: string;
  to: string;
  /** 这周完成了什么。 */
  done: string;
  /** 这周没做完什么。 */
  undone: string;
  /** 下周建议。 */
  next: string;
  updatedAt: string;
}

export interface Settings {
  apiKey: string;
  model: string;
  /** 0–23，早晚分界小时：此小时之前算「早」，起算「晚」。 */
  daySplitHour: number;
  /** 阿里云百炼 API Key（识别 qwen3-asr-flash + 朗读 qwen3-tts-flash）。空则用本地未提交的调试回退。 */
  asrAppKey?: string;
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
  | "agent_stop"
  | "parse_fail"
  | "parse_ok"
  | "dedupe"
  | "notify";

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

/** 待办页新增/编辑表单提交的草稿。 */
export interface TodoDraft {
  title: string;
  when: "today" | "later";
  projectId?: string | null;
  newTitle?: string;
  due?: string;
  estimate?: number;
  priority?: "high" | "normal";
  reason?: string;
}

export interface ProposedTodo {
  title: string;
  reason?: string;
  when?: "today" | "later";
  priority?: "high" | "normal";
  due?: string;
  /** 预估耗时（分钟），可选。 */
  estimate?: number;
  /** 项目标题，落库时解析成 projectId。 */
  project?: string;
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
  /** 组手动排位；缺失时按 createdAt 兜底。 */
  order?: number;
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

export interface ParsedTask {
  title: string;
  reason?: string;
  priority?: "high" | "normal";
  due?: string;
  /** 预估耗时（分钟），可选。 */
  estimate?: number;
  /** 项目标题，优先从现有项目里选。 */
  project?: string;
  /** 把握（解析层仍输出，路由不再按它静默落库；全部进确认框）。 */
  confidence?: "high" | "low";
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

/** 解析层对一条用户输入的结构化产出；全空 = 纯闲聊。 */
export interface ParseResult {
  events: string[];
  decisions: string[];
  tasks: ParsedTask[];
  projectUpdates: ProjectUpdate[];
  waitings: ParsedWaiting[];
  waitingsResolved: string[];
}

export const DEFAULT_MODEL = "deepseek-v4-flash";
