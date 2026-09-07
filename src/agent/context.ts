import type { ApiMessage } from "@/api/deepseek";
import { normKey } from "@/norm";
import { todoMeta } from "@/todo-meta";
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

/** 每条待办带属性：急 / 截止 / 约多久 / 属于哪摊事，模型追问才有依据。 */
function titles(todos: Todo[], today: string, projectTitles?: Map<string, string>): string {
  return todos
    .map((t) => {
      const meta = todoMeta(
        { priority: t.priority, due: t.due, estimate: t.estimate, project: t.projectId ? projectTitles?.get(t.projectId) : undefined },
        today,
      );
      return meta ? `${t.title}（${meta}）` : t.title;
    })
    .join("；");
}

export function formatBucket(label: string, todos: Todo[], today?: string, projectTitles?: Map<string, string>): string {
  if (todos.length === 0) return `${label} 0 件。`;
  return `${label} ${todos.length} 件：${titles(todos, today ?? "", projectTitles)}。`;
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
  const projectTitles = new Map((input.projects ?? []).map((p) => [p.id, p.title]));
  const facts = [
    `今天是 ${input.date}，${input.timeLabel}。当前模式：${modeLabel(input.mode)}。`,
    input.planConfirmed ? "今天已经确认过今日计划。" : "今天还没有确认过今日计划。",
    input.yesterdayLog ? formatYesterdayLog(input.yesterdayLog) : "",
    formatBucket("今天", input.todayTodos, input.date, projectTitles),
    formatBucket("以后", input.laterTodos, input.date, projectTitles),
    formatBucket("今日已完成", input.doneToday, input.date, projectTitles),
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
