import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { dayTranscript } from "@/chat-session";
import { snapshotLogTitles } from "@/todos";
import type { DailyLog, DayChat, Todo } from "@/types";
import { parseJsonObject } from "./parse-json";
import { diaryPrompt } from "./prompt";

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
    dayTranscript(input.chat),
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
