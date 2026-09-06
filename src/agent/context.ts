import type { ApiMessage } from "@/api/deepseek";
import { normKey } from "@/norm";
import { isChitchat } from "./parse";
import type {
  ChatMessage,
  ChatMode,
  DailyLog,
  ParseResult,
  Project,
  TimelineEvent,
  Todo,
  Waiting,
} from "@/types";

/** 注入的聊天历史上限：事实已被解析层抽走，历史只负责语气与连贯。 */
export const HISTORY_LIMIT = 12;

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

function formatProjects(projects: Project[]): string {
  const active = projects.filter((p) => p.status === "active");
  if (active.length === 0) return "进行中的项目 0 个。";
  return `进行中的项目 ${active.length} 个：${active.map((p) => (p.note ? `${p.title}（${p.note}）` : p.title)).join("；")}。`;
}

function formatWaitings(waitings: Waiting[]): string {
  if (waitings.length === 0) return "等待中 0 件。";
  return `等待中 ${waitings.length} 件：${waitings.map((w) => (w.waitingOn ? `${w.text}（等${w.waitingOn}）` : w.text)).join("；")}。`;
}

export function matchedProjectKeys(result: ParseResult): string[] {
  const keys = new Set<string>();
  for (const u of result.projectUpdates) keys.add(normKey(u.project));
  for (const t of result.tasks) if (t.project) keys.add(normKey(t.project));
  return [...keys];
}

/** 按需取事件：纯闲聊不取；否则取当天全部 + 文本命中相关项目的近期事件，最多 10 条。 */
export function selectRelevantEvents(
  events: TimelineEvent[],
  result: ParseResult | null | undefined,
  today: string,
): TimelineEvent[] {
  if (!result || isChitchat(result)) return [];
  const keys = matchedProjectKeys(result);
  const picked = events.filter((e) => e.date === today || keys.some((k) => normKey(e.text).includes(k)));
  return picked.slice(-10);
}

function formatEvents(events: TimelineEvent[]): string {
  if (events.length === 0) return "";
  return `近期相关记录 ${events.length} 条：${events.map((e) => (e.kind === "decision" ? `定了：${e.text}` : e.text)).join("；")}。`;
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
  projects?: Project[];
  waitings?: Waiting[];
  parseResult?: ParseResult | null;
  recentEvents?: TimelineEvent[];
}): ApiMessage[] {
  const facts = [
    `今天是 ${input.date}，${input.timeLabel}。当前模式：${modeLabel(input.mode)}。`,
    input.planConfirmed ? "今天已经确认过今日计划。" : "今天还没有确认过今日计划。",
    input.yesterdayLog ? formatYesterdayLog(input.yesterdayLog) : "",
    formatBucket("今天", input.todayTodos),
    formatBucket("以后", input.laterTodos),
    formatBucket("今日已完成", input.doneToday),
    formatProjects(input.projects ?? []),
    formatWaitings(input.waitings ?? []),
    formatEvents(selectRelevantEvents(input.recentEvents ?? [], input.parseResult, input.date)),
    "待办列表是唯一真相。有没有完成，只看上面的分区，不要根据聊天记录判断。以后不算没做完。",
  ].join("");
  const history: ApiMessage[] = input.messages.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [{ role: "system", content: facts }, ...history];
}
