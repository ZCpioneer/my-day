import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { localDate, weekDates, weekKey } from "@/dates";
import type { DailyLog, Todo, WeeklyLog } from "@/types";
import { parseJsonObject } from "./parse-json";
import { weeklyPrompt } from "./prompt";

export async function composeWeeklyLog(input: {
  now: Date;
  logs: DailyLog[];
  todos: Todo[];
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
  model: string;
}): Promise<WeeklyLog> {
  const week = weekKey(input.now);
  const days = weekDates(input.now);
  const inWeek = new Set(days);
  const logByDate = new Map(input.logs.map((l) => [l.date, l]));
  const dayLines = days.map((d) => {
    const log = logByDate.get(d);
    if (!log) return `${d}：没有日记`;
    return `${d}：${log.mood ? `${log.mood} ` : ""}${log.state}`;
  });
  // 勾掉的按 completedAt 落到本周筛；「没做完」列本周立下（sourceDate 在本周）还开着的。
  const doneThisWeek = input.todos.filter(
    (t) => t.status === "done" && !!t.completedAt && inWeek.has(localDate(new Date(t.completedAt))),
  );
  const openFromWeek = input.todos.filter((t) => t.status === "open" && inWeek.has(t.sourceDate));
  const facts = [
    `周：${week}（${days[0]} 到 ${days[6]}）`,
    "七天日记：",
    dayLines.join("\n"),
    `本周勾掉的待办：${doneThisWeek.length ? doneThisWeek.map((t) => t.title).join("；") : "无"}`,
    `本周立下还没做完的待办：${openFromWeek.length ? openFromWeek.map((t) => t.title).join("；") : "无"}`,
  ].join("\n");

  const res = await input.complete({
    model: input.model,
    messages: [
      { role: "system", content: weeklyPrompt() },
      { role: "user", content: facts },
    ],
    tools: [],
    stream: false,
  });
  const parsed = typeof res.content === "string" ? parseJsonObject(res.content) : undefined;
  if (!parsed || typeof parsed !== "object") throw new Error("周报这轮没生成");
  const done = (parsed as { done?: unknown }).done;
  const undone = (parsed as { undone?: unknown }).undone;
  const next = (parsed as { next?: unknown }).next;
  if (typeof done !== "string" || typeof undone !== "string" || typeof next !== "string") {
    throw new Error("周报这轮没生成");
  }

  return {
    week,
    from: days[0],
    to: days[6],
    done,
    undone,
    next,
    updatedAt: input.now.toISOString(),
  };
}
