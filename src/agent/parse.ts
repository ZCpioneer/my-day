import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { debugLog } from "@/debug/log";
import type { MemoryCandidate, ParsedTask, ParsedWaiting, ParseResult, ProjectUpdate } from "@/types";
import { parseJsonObject } from "./parse-json";

export function emptyParseResult(): ParseResult {
  return {
    events: [],
    decisions: [],
    tasks: [],
    projectUpdates: [],
    waitings: [],
    waitingsResolved: [],
    memories: [],
  };
}

export function isChitchat(r: ParseResult): boolean {
  return (
    r.events.length +
      r.decisions.length +
      r.tasks.length +
      r.projectUpdates.length +
      r.waitings.length +
      r.waitingsResolved.length +
      r.memories.length ===
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

function asMemories(v: unknown): MemoryCandidate[] {
  if (!Array.isArray(v)) return [];
  const out: MemoryCandidate[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const text = asString(o.text);
    const kind = o.kind === "preference" || o.kind === "goal" || o.kind === "watch" ? o.kind : undefined;
    if (!text || !kind) continue;
    out.push({ text, kind });
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
    memories: asMemories(o.memories),
  };
}

export function parseSystemPrompt(): string {
  return `你在为「朝暮」做输入解析。只输出一个 JSON 对象，不要 markdown，不要其它字。

把用户刚说的这句话拆成结构化信息：
- events: string[] 发生了什么（已发生的事实、见闻、状态），一句一条
- decisions: string[] 用户已经拍板的决定
- tasks: { "title": string, "reason"?: string, "priority"?: "high"|"normal", "due"?: string, "project"?: string }[] 用户自己要去做的行动
- projectUpdates: { "project": string, "note": string, "status"?: "active"|"done"|"paused" }[] 某个项目的进展；project 优先用现有项目标题，没有就起个短名；status 只在明确完结或暂停时给
- waitings: { "text": string, "waitingOn"?: string }[] 正在等别人或等外部条件的事
- waitingsResolved: string[] 这句话表明之前等待的事有了结果（按等待内容简述）
- memories: { "text": string, "kind": "preference"|"goal"|"watch" }[] 长期记忆候选

判断规则：
1. 随口一说不是 task：愿望（"好想…"）、假设（"要是有空…"）、吐槽、情绪、已发生无需行动的事、别人的事，都不是 task。只有用户自己要采取的行动才是 task。
2. 一个月后它还会影响你给用户的建议，才进 memories：preference 稳定偏好、goal 长期目标、watch 持续关注。单次事件、具体任务、临时状态（"今天累了"）一律不进。
3. due 用 ISO 日期（如 2026-09-07）；只有话里能推出具体时间时才给。
4. priority 只在明显要紧（紧迫截止、用户强调）时给 "high"。
5. 没有对应的类别就留空数组。纯闲聊六个数组全空。
6. 不要编造用户没说的内容。`;
}

export function parseUserContent(input: {
  text: string;
  date: string;
  todoTitles: string[];
  projectTitles: string[];
}): string {
  return [
    `今天是 ${input.date}。`,
    `现有待办：${input.todoTitles.length ? input.todoTitles.join("；") : "无"}。`,
    `现有项目：${input.projectTitles.length ? input.projectTitles.join("；") : "无"}。`,
    `用户刚说：「${input.text}」`,
    "只解析「用户刚说」这句，输出 JSON。",
  ].join("\n");
}

/** 独立解析调用：把一条用户输入拆成结构化信息。永不抛异常——失败记 debug 并返回全空，不阻塞对话。 */
export async function parseInput(args: {
  text: string;
  date: string;
  todos: { title: string }[];
  projects: { title: string }[];
  model: string;
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
