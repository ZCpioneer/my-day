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
  // 早计划逐项对照只作为输入喂给模型：复盘（state）照着写，不用自己猜勾选；日记本身不再单列这些段。
  const contrast = [...snap.done.map((t) => `${t}（做了）`), ...snap.undone.map((t) => `${t}（没做）`)];
  const facts = [
    `日期：${input.date}`,
    input.chat.planConfirmedAt ? "当天确认过今日计划。" : "当天没有确认过今日计划。",
    `今日计划对照：${contrast.length ? contrast.join("；") : "今天桶里没排事"}`,
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
  const state = (parsed as { state?: unknown }).state;
  if (typeof state !== "string") throw new Error("日记这轮没写成");
  // mood/cheer 容错：模型没给不挡日记落库，页面按有无渲染。
  const mood = (parsed as { mood?: unknown }).mood;
  const cheer = (parsed as { cheer?: unknown }).cheer;

  return {
    date: input.date,
    state,
    ...(typeof mood === "string" && mood.trim() ? { mood: mood.trim() } : {}),
    ...(typeof cheer === "string" && cheer.trim() ? { cheer: cheer.trim() } : {}),
    updatedAt: input.now.toISOString(),
  };
}
