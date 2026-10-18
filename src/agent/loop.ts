import type { ApiMessage, ChatCompletionRequest, ChatCompletionResponse, ToolCall } from "@/api/deepseek";
import { localDate } from "@/dates";
import { debugLog, logDrops } from "@/debug/log";
import { filterTodayPlanItems, withoutCoveredTitles } from "@/todos-filter";
import { partitionTodos } from "@/todos";
import type { ChatMessage, ChatMode, DailyLog, ParseResult, Project, ProposedTodo, TimelineEvent, Todo, Waiting } from "@/types";
import { attributionTexts, isClarifyQuestion, prepareLaterProposals } from "./clarify";
import { buildContextMessages, formatBucket } from "./context";
import { parseJsonObject } from "./parse-json";
import { systemPrompt } from "./prompt";
import { TOOL_DEFS } from "./tools";

export const MAX_MODEL_CALLS = 4;

export interface AgentDeps {
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
  /**
   * 可选：流式补全。有它时回复循环改走它，onText 收到的是「到目前为止的累积全文」；
   * 返回与 complete 同形。没有则完全走非流式老路。
   */
  completeStream?: (
    req: ChatCompletionRequest,
    onText: (accumulated: string) => void,
  ) => Promise<ChatCompletionResponse>;
  listTodos: () => Promise<Todo[]>;
  setTodayPlan: (items: ProposedTodo[]) => Promise<void>;
  /** propose_todos 确认后落库（进「以后」）。 */
  addTodos: (items: ProposedTodo[]) => Promise<void>;
  now: () => Date;
  onPropose: (items: ProposedTodo[], kind: "later" | "today") => Promise<ProposedTodo[]>;
}

function formatTimeLabel(now: Date): string {
  const h = now.getHours();
  const period = h < 6 ? "凌晨" : h < 12 ? "上午" : h < 18 ? "下午" : "晚上";
  const hh = String(h).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${period} ${hh}:${mm}`;
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

/** propose_todos 的完整字段校验；任何一条坏条目整体作废（模型重试比半截落库好）。 */
function asProposedTodos(raw: unknown): ProposedTodo[] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  const out: ProposedTodo[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") return undefined;
    const o = it as Record<string, unknown>;
    if (typeof o.title !== "string" || !o.title.trim()) return undefined;
    const estimate = o.estimate;
    out.push({
      title: o.title.trim(),
      reason: typeof o.reason === "string" ? o.reason : undefined,
      priority: o.priority === "high" ? "high" : o.priority === "normal" ? "normal" : undefined,
      due: typeof o.due === "string" ? o.due : undefined,
      estimate: typeof estimate === "number" && Number.isFinite(estimate) && estimate > 0 ? Math.round(estimate) : undefined,
      project: typeof o.project === "string" && o.project.trim() ? o.project.trim() : undefined,
    });
  }
  return out;
}

function formatTodos(todos: Todo[], date: string): string {
  const { today, later, doneToday } = partitionTodos(todos, date);
  return formatBucket("今天", today, date) + formatBucket("以后", later, date) + formatBucket("今日已完成", doneToday, date);
}

async function executeTool(tc: ToolCall, deps: AgentDeps, mentionTexts: string[]): Promise<string> {
  const name = tc.function.name;
  const parsed = parseJsonObject(tc.function.arguments);
  if (parsed === undefined) return "参数无效";

  if (name === "list_todos") {
    const todos = await deps.listTodos();
    return formatTodos(todos, localDate(deps.now()));
  }

  if (name === "propose_todos") {
    const items = asProposedTodos(parsed);
    if (!items) return "参数无效";
    const valid = withoutCoveredTitles(items, await deps.listTodos());
    logDrops("propose_todos", items.map((i) => i.title), valid.map((i) => i.title));
    if (valid.length === 0) return "这些事待办里已经有了，不用重复记";
    const prepared = prepareLaterProposals(valid, mentionTexts);
    logDrops("propose_todos", valid.map((i) => i.title), prepared.map((i) => i.title));
    if (prepared.length === 0) return "这些事待办里已经有了，不用重复记";
    debugLog.push({
      event: "propose_ui",
      tool: "propose_todos",
      detail: prepared.map((v) => v.title).join("、"),
    });
    const accepted = await deps.onPropose(prepared, "later");
    if (accepted.length === 0) {
      debugLog.push({ event: "todo_rejected", tool: "propose_todos", detail: "用户这次不加" });
      return "用户这次不加";
    }
    await deps.addTodos(accepted);
    const titles = accepted.map((a) => a.title).join("、");
    debugLog.push({ event: "todo_confirmed", tool: "propose_todos", detail: titles });
    return `用户已确认记下：${titles}`;
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
  parseResult?: ParseResult | null;
  recentEvents?: TimelineEvent[];
  /** 流式回复回调：收到的是本轮模型到目前为止的累积全文；工具轮没有文本，不会触发。 */
  onReplyDelta?: (accumulated: string) => void;
}): Promise<{ assistantText: string; stopped: boolean; executedPropose: boolean }> {
  const { deps, mode, userText, history, model } = input;
  const now = deps.now();
  const date = localDate(now);
  const todos = await deps.listTodos();
  const { today, later, doneToday } = partitionTodos(todos, date);
  const mentionTexts = attributionTexts(userText, history);
  let executedPropose = false;

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
      parseResult: input.parseResult ?? null,
      recentEvents: input.recentEvents ?? [],
    }),
    { role: "user", content: userText },
  ];

  for (let i = 0; i < MAX_MODEL_CALLS; i++) {
    const req: ChatCompletionRequest = {
      model,
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      stream: false,
    };
    // 有流式实现就走流式：文本轮 onText 逐字透传出去；工具轮本来就没文本，自然不触发，不用特殊处理。
    let streamed = "";
    const res = deps.completeStream
      ? await deps.completeStream(req, (text) => {
          streamed = text;
          input.onReplyDelta?.(text);
        })
      : await deps.complete(req);
    const text = res.content || streamed || "";
    if (!res.tool_calls || res.tool_calls.length === 0) {
      return { assistantText: res.content || streamed || "", stopped: false, executedPropose };
    }
    // 引导问当轮不执行任何工具，问句即最终回复，避免续轮再提议。
    if (isClarifyQuestion(text)) {
      const dropped = (res.tool_calls ?? []).map((tc) => tc.function.name).join("、");
      debugLog.push({ event: "todo_rejected", tool: "clarify", detail: `引导问当轮不提议，丢掉 ${dropped}` });
      return { assistantText: text, stopped: false, executedPropose: false };
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
      if (tc.function.name === "propose_todos" || tc.function.name === "set_today_plan") executedPropose = true;
      const result = await executeTool(tc, deps, mentionTexts);
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
  return { assistantText: "这轮没做成，再说一次。", stopped: true, executedPropose };
}
