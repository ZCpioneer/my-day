import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { debugLog } from "@/debug/log";
import type { ParsedTask, ParsedWaiting, ParseResult, ProjectUpdate } from "@/types";
import { parseJsonObject } from "./parse-json";

export function emptyParseResult(): ParseResult {
  return {
    events: [],
    decisions: [],
    tasks: [],
    projectUpdates: [],
    waitings: [],
    waitingsResolved: [],
  };
}

export function isChitchat(r: ParseResult): boolean {
  return (
    r.events.length +
      r.decisions.length +
      r.tasks.length +
      r.projectUpdates.length +
      r.waitings.length +
      r.waitingsResolved.length ===
    0
  );
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asEstimate(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return Math.round(v);
}

function asTasks(v: unknown): ParsedTask[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedTask[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const title = asString(o.title);
    if (!title) continue;
    out.push({
      title,
      reason: asString(o.reason),
      priority: o.priority === "high" ? "high" : o.priority === "normal" ? "normal" : undefined,
      due: asString(o.due),
      estimate: asEstimate(o.estimate),
      project: asString(o.project),
    });
  }
  return out;
}

function asProjectUpdates(v: unknown): ProjectUpdate[] {
  if (!Array.isArray(v)) return [];
  const out: ProjectUpdate[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const project = asString(o.project);
    const note = asString(o.note);
    if (!project || !note) continue;
    const status = o.status === "done" || o.status === "paused" || o.status === "active" ? o.status : undefined;
    out.push({ project, note, status });
  }
  return out;
}

function asWaitings(v: unknown): ParsedWaiting[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedWaiting[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const text = asString(o.text);
    if (!text) continue;
    out.push({ text, waitingOn: asString(o.waitingOn) });
  }
  return out;
}

export function asParseResult(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object") return emptyParseResult();
  const o = raw as Record<string, unknown>;
  return {
    events: asStringList(o.events),
    decisions: asStringList(o.decisions),
    tasks: asTasks(o.tasks),
    projectUpdates: asProjectUpdates(o.projectUpdates),
    waitings: asWaitings(o.waitings),
    waitingsResolved: asStringList(o.waitingsResolved),
  };
}

export function parseSystemPrompt(): string {
  return `你是「AI 日程秘书」的输入解析模块。只输出一个 JSON 对象，不要 markdown，不要其它字。

把用户刚说的这句话拆成结构化信息：
- events: string[] 发生了什么（已发生的事实、见闻、状态），一句一条
- decisions: string[] 用户已经拍板的决定
- tasks: { "title": string, "reason"?: string, "priority"?: "high"|"normal", "due"?: string, "estimate"?: number, "project"?: string }[] 用户自己要去做的行动
- projectUpdates: { "project": string, "note": string, "status"?: "active"|"done"|"paused" }[] 某个项目的进展；project 优先用现有项目标题，没有就起个短名；status 只在明确完结或暂停时给
- waitings: { "text": string, "waitingOn"?: string }[] 正在等别人或等外部条件的事
- waitingsResolved: string[] 这句话表明之前等待的事有了结果（按等待内容简述）

判断规则：
1. 随口一说不是 task：愿望（"好想…"）、假设（"要是有空…"）、吐槽、情绪、已发生无需行动的事、别人的事，都不是 task。但注意区分愿望和承诺：「我要做 / 我打算 / 我准备 X」是用户自己要做的事，是 task。
2. 偏好、目标、感慨这类长期内容不属于任何一类：不要为它们造 task，也不用记录。这个工具只管当下。
3. due 用 ISO 日期（如 2026-09-07）；只有话里能推出具体时间时才给。
4. priority 只在明显要紧（紧迫截止、用户强调）时给 "high"。
5. estimate 是预估耗时，单位分钟（整数）：话里提到大概多久（"半小时"→30、"一个小时左右"→60）才给，没提就不给。
6. project 是这摊事归哪个大任务/项目：话里指明了归属就填，优先用现有项目标题，新的一摊事可以起个短名；拿不准就不带，别硬凑。
7. 带了「最近对话」时，它是上下文：用户这句可能是在回答秘书的提问（要不要拆成几步、归到哪摊事、什么时候要）。回答拆分提问（如"拆成两步：先 A 再 B"）时把每一步抽成 task；回答里冒出的新行动照样抽成 task；都结合上下文填 project/due/estimate。但只解析「用户刚说」这句，不要替上文补抽。
8. 没有对应的类别就留空数组。纯闲聊五个数组全空。
9. 不要编造用户没说的内容。`;
}

export function parseUserContent(input: {
  text: string;
  date: string;
  todoTitles: string[];
  projectTitles: string[];
  recent?: { role: "user" | "assistant"; content: string }[];
}): string {
  const lines = [
    `今天是 ${input.date}。`,
    `现有待办：${input.todoTitles.length ? input.todoTitles.join("；") : "无"}。`,
    `现有项目：${input.projectTitles.length ? input.projectTitles.join("；") : "无"}。`,
  ];
  if (input.recent && input.recent.length > 0) {
    lines.push("最近对话（只是上下文，不要替它们补抽）：");
    for (const m of input.recent) {
      lines.push(`${m.role === "user" ? "用户" : "秘书"}：${m.content}`);
    }
  }
  lines.push(`用户刚说：「${input.text}」`, "只解析「用户刚说」这句，输出 JSON。");
  return lines.join("\n");
}

/** 独立解析调用：把一条用户输入拆成结构化信息。永不抛异常——失败记 debug 并返回全空，不阻塞对话。 */
export async function parseInput(args: {
  text: string;
  date: string;
  todos: { title: string }[];
  projects: { title: string }[];
  model: string;
  /** 最近几条对话（不含本条），帮解析看懂「归入装修那摊」这类承接回答。 */
  recent?: { role: "user" | "assistant"; content: string }[];
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
}): Promise<ParseResult> {
  try {
    const res = await args.complete({
      model: args.model,
      messages: [
        { role: "system", content: parseSystemPrompt() },
        {
          role: "user",
          content: parseUserContent({
            text: args.text,
            date: args.date,
            todoTitles: args.todos.map((t) => t.title),
            projectTitles: args.projects.map((p) => p.title),
            recent: args.recent,
          }),
        },
      ],
      tools: [],
      stream: false,
    });
    const raw = typeof res.content === "string" ? parseJsonObject(res.content) : undefined;
    if (raw === undefined) {
      debugLog.push({ event: "parse_fail", detail: "解析输出不是 JSON" });
      return emptyParseResult();
    }
    return asParseResult(raw);
  } catch (e) {
    debugLog.push({ event: "parse_fail", detail: e instanceof Error ? e.message : String(e) });
    return emptyParseResult();
  }
}
