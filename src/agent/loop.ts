import type { ApiMessage, ChatCompletionRequest, ChatCompletionResponse, ToolCall } from "@/api/deepseek";
import { localDate } from "@/dates";
import { debugLog } from "@/debug/log";
import { filterTodayPlanItems } from "@/todos-filter";
import { partitionTodos } from "@/todos";
import type { ChatMessage, ChatMode, DailyLog, Memory, ParseResult, Project, ProposedTodo, TimelineEvent, Todo, Waiting } from "@/types";
import { buildContextMessages } from "./context";
import { systemPrompt } from "./prompt";
import { TOOL_DEFS } from "./tools";

export const MAX_MODEL_CALLS = 4;

export interface AgentDeps {
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
  listTodos: () => Promise<Todo[]>;
  setTodayPlan: (items: ProposedTodo[]) => Promise<void>;
  now: () => Date;
  onPropose: (items: ProposedTodo[], kind: "later" | "today" | "memory") => Promise<ProposedTodo[]>;
}

function formatTimeLabel(now: Date): string {
  const h = now.getHours();
  const period = h < 6 ? "凌晨" : h < 12 ? "上午" : h < 18 ? "下午" : "晚上";
  const hh = String(h).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${period} ${hh}:${mm}`;
}

function parseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function asProposedItems(raw: unknown): ProposedTodo[] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  const out: ProposedTodo[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") return undefined;
    const title = (it as { title?: unknown }).title;
    if (typeof title !== "string") return undefined;
    const reason = (it as { reason?: unknown }).reason;
    out.push({ title, reason: typeof reason === "string" ? reason : undefined });
  }
  return out;
}

function formatBucket(label: string, todos: Todo[]): string {
  if (todos.length === 0) return `${label} 0 件`;
  return `${label} ${todos.length} 件：${todos.map((t) => t.title).join("；")}`;
}

function formatTodos(todos: Todo[], date: string): string {
  const { today, later, doneToday } = partitionTodos(todos, date);
  return `${formatBucket("今天", today)}。${formatBucket("以后", later)}。${formatBucket("今日已完成", doneToday)}。`;
}

async function executeTool(tc: ToolCall, deps: AgentDeps): Promise<string> {
  const name = tc.function.name;
  const parsed = parseJson(tc.function.arguments);
  if (parsed === undefined) return "参数无效";

  if (name === "list_todos") {
    const todos = await deps.listTodos();
    return formatTodos(todos, localDate(deps.now()));
  }

  if (name === "set_today_plan") {
    const items = asProposedItems(parsed);
    if (!items) return "参数无效";
    const valid = filterTodayPlanItems(items);
    if (valid.length === 0) return "没有可定的今日事项";
    debugLog.push({
      event: "propose_ui",
      tool: "set_today_plan",
      detail: valid.map((v) => v.title).join("、"),
    });
    const accepted = await deps.onPropose(valid, "today");
    if (accepted.length === 0) {
      debugLog.push({ event: "todo_rejected", tool: "set_today_plan", detail: "用户先不定" });
      return "用户先不定今天的计划";
    }
    await deps.setTodayPlan(accepted);
    const titles = accepted.map((a) => a.title).join("、");
    debugLog.push({ event: "todo_confirmed", tool: "set_today_plan", detail: titles });
    return `用户已确认今日计划：${titles}`;
  }

  return "未知工具";
}

export async function runAgent(input: {
  deps: AgentDeps;
  mode: ChatMode;
  userText: string;
  history: ChatMessage[];
  model: string;
  planConfirmed?: boolean;
  yesterdayLog?: DailyLog | null;
  projects?: Project[];
  waitings?: Waiting[];
  memories?: Memory[];
  parseResult?: ParseResult | null;
  recentEvents?: TimelineEvent[];
}): Promise<{ assistantText: string; stopped: boolean }> {
  const { deps, mode, userText, history, model } = input;
  const now = deps.now();
  const date = localDate(now);
  const todos = await deps.listTodos();
  const { today, later, doneToday } = partitionTodos(todos, date);

  const messages: ApiMessage[] = [
    { role: "system", content: systemPrompt() },
    ...buildContextMessages({
      date,
      timeLabel: formatTimeLabel(now),
      mode,
      todayTodos: today,
      laterTodos: later,
      doneToday,
      messages: history,
      planConfirmed: input.planConfirmed ?? false,
      yesterdayLog: input.yesterdayLog ?? null,
      projects: input.projects ?? [],
      waitings: input.waitings ?? [],
      memories: input.memories ?? [],
      parseResult: input.parseResult ?? null,
      recentEvents: input.recentEvents ?? [],
    }),
    { role: "user", content: userText },
  ];

  for (let i = 0; i < MAX_MODEL_CALLS; i++) {
    const res = await deps.complete({
      model,
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      stream: false,
    });
    if (!res.tool_calls || res.tool_calls.length === 0) {
      return { assistantText: res.content || "", stopped: false };
    }
    messages.push({
      role: "assistant",
      content: res.content,
      tool_calls: res.tool_calls,
    });
    for (const tc of res.tool_calls) {
      debugLog.push({
        event: "tool_call",
        tool: tc.function.name,
        detail: tc.function.arguments,
      });
      const result = await executeTool(tc, deps);
      debugLog.push({
        event: "tool_result",
        tool: tc.function.name,
        detail: result,
      });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  debugLog.push({ event: "agent_stop", detail: "这轮没做成，再说一次。" });
  return { assistantText: "这轮没做成，再说一次。", stopped: true };
}
