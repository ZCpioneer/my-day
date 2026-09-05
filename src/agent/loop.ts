import type { ApiMessage, ChatCompletionRequest, ChatCompletionResponse, ToolCall } from "@/api/deepseek";
import { localDate } from "@/dates";
import { debugLog } from "@/debug/log";
import { filterProposedTodos } from "@/todos-filter";
import type { ChatMessage, ChatMode, DailyLog, ProposedTodo, Todo } from "@/types";
import { buildContextMessages } from "./context";
import { systemPrompt } from "./prompt";
import { TOOL_DEFS } from "./tools";

export const MAX_MODEL_CALLS = 4;

export interface AgentDeps {
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
  listTodos: () => Promise<Todo[]>;
  addTodos: (items: ProposedTodo[]) => Promise<void>;
  writeDailyLog: (log: DailyLog) => Promise<void>;
  now: () => Date;
  onPropose: (items: ProposedTodo[]) => Promise<ProposedTodo[]>;
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

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
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

function isDoneToday(t: Todo, date: string): boolean {
  return t.status === "done" && !!t.completedAt && localDate(new Date(t.completedAt)) === date;
}

function snapshotTodoTitles(todos: Todo[], date: string): { done: string[]; undone: string[] } {
  return {
    undone: todos.filter((t) => t.status === "open").map((t) => t.title),
    done: todos.filter((t) => isDoneToday(t, date)).map((t) => t.title),
  };
}

function formatTodos(todos: Todo[], date: string): string {
  const open = todos.filter((t) => t.status === "open");
  const done = todos.filter((t) => isDoneToday(t, date));
  const openPart =
    open.length === 0
      ? "未完成 0 件"
      : `未完成 ${open.length} 件：${open
          .map((t) => (t.sourceDate !== date ? `${t.title}（跨天）` : t.title))
          .join("；")}`;
  const donePart =
    done.length === 0 ? "已完成 0 件" : `已完成 ${done.length} 件：${done.map((t) => t.title).join("；")}`;
  return `${openPart}。${donePart}。`;
}

async function executeTool(tc: ToolCall, deps: AgentDeps): Promise<string> {
  const name = tc.function.name;
  const parsed = parseJson(tc.function.arguments);
  if (parsed === undefined) return "参数无效";

  if (name === "list_todos") {
    const todos = await deps.listTodos();
    return formatTodos(todos, localDate(deps.now()));
  }

  if (name === "propose_todos") {
    const items = asProposedItems(parsed);
    if (!items) return "参数无效";
    const existing = await deps.listTodos();
    const valid = filterProposedTodos(items, existing);
    if (valid.length === 0) return "没有可新增的任务";
    debugLog.push({
      event: "propose_ui",
      tool: "propose_todos",
      detail: valid.map((v) => v.title).join("、"),
    });
    const accepted = await deps.onPropose(valid);
    if (accepted.length === 0) {
      debugLog.push({ event: "todo_rejected", tool: "propose_todos", detail: "用户这次不加" });
      return "用户这次不加";
    }
    await deps.addTodos(accepted);
    const titles = accepted.map((a) => a.title).join("、");
    debugLog.push({ event: "todo_confirmed", tool: "propose_todos", detail: titles });
    return `用户已加入：${titles}`;
  }

  if (name === "suggest_order") {
    if (!parsed || typeof parsed !== "object") return "参数无效";
    const order = (parsed as { order?: unknown }).order;
    if (!isStringArray(order)) return "参数无效";
    return `已记下建议顺序：${order.join("、")}`;
  }

  if (name === "write_daily_log") {
    if (!parsed || typeof parsed !== "object") return "参数无效";
    const o = parsed as { plan?: unknown; state?: unknown };
    if (typeof o.plan !== "string" || typeof o.state !== "string") {
      return "参数无效";
    }
    const now = deps.now();
    const date = localDate(now);
    const snap = snapshotTodoTitles(await deps.listTodos(), date);
    const log: DailyLog = {
      date,
      plan: o.plan,
      done: snap.done,
      undone: snap.undone,
      state: o.state,
      updatedAt: now.toISOString(),
    };
    try {
      await deps.writeDailyLog(log);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    debugLog.push({ event: "log_written", tool: "write_daily_log", detail: log.date });
    return "已写入今日日记";
  }

  return "未知工具";
}

export async function runAgent(input: {
  deps: AgentDeps;
  mode: ChatMode;
  userText: string;
  history: ChatMessage[];
  model: string;
}): Promise<{ assistantText: string; stopped: boolean }> {
  const { deps, mode, userText, history, model } = input;
  const now = deps.now();
  const date = localDate(now);
  const todos = await deps.listTodos();
  const openTodos = todos.filter((t) => t.status === "open");
  const doneToday = todos.filter((t) => isDoneToday(t, date));

  const messages: ApiMessage[] = [
    { role: "system", content: systemPrompt() },
    ...buildContextMessages({
      date,
      timeLabel: formatTimeLabel(now),
      mode,
      openTodos,
      doneToday,
      messages: history,
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
