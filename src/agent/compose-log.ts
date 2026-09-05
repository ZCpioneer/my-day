import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { snapshotLogTitles } from "@/todos";
import type { ChatMessage, DailyLog, DayChat, Todo } from "@/types";
import { diaryPrompt } from "./prompt";

function parseJsonObject(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(body);
  if (direct && typeof direct === "object") return direct;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(body.slice(start, end + 1));
  return undefined;
}

function transcript(messages: ChatMessage[]): string {
  if (messages.length === 0) return "（当天没有对话）";
  return messages
    .map((m) => `${m.role === "user" ? "我" : "朝暮"}：${m.content}`)
    .join("\n");
}

export async function composeDailyLog(input: {
  date: string;
  now: Date;
  chat: DayChat;
  todos: Todo[];
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
  model: string;
}): Promise<DailyLog> {
  const snap = snapshotLogTitles(input.todos, input.date);
  const facts = [
    `日期：${input.date}`,
    input.chat.planConfirmedAt ? "当天确认过今日计划。" : "当天没有确认过今日计划。",
    `做成了：${snap.done.length ? snap.done.join("；") : "无"}`,
    `没做完：${snap.undone.length ? snap.undone.join("；") : "无"}`,
    "对话：",
    transcript(input.chat.messages),
  ].join("\n");

  const res = await input.complete({
    model: input.model,
    messages: [
      { role: "system", content: diaryPrompt() },
      { role: "user", content: facts },
    ],
    tools: [],
    stream: false,
  });
  const parsed = typeof res.content === "string" ? parseJsonObject(res.content) : undefined;
  if (!parsed || typeof parsed !== "object") throw new Error("日记这轮没写成");
  const plan = (parsed as { plan?: unknown }).plan;
  const state = (parsed as { state?: unknown }).state;
  if (typeof plan !== "string" || typeof state !== "string") throw new Error("日记这轮没写成");

  return {
    date: input.date,
    plan,
    done: snap.done,
    undone: snap.undone,
    state,
    updatedAt: input.now.toISOString(),
  };
}
