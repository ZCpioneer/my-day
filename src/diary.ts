import { shiftLocalDate } from "./dates";
import { isDoneOn } from "./todos";
import type { DayChat, DailyLog, Todo } from "./types";

export const CATCH_UP_LOOKBACK_DAYS = 14;

export function hasDiaryTraces(input: { chat: DayChat; todos: Todo[]; date: string }): boolean {
  if (input.chat.planConfirmedAt) return true;
  if (input.chat.messages.length > 0) return true;
  return input.todos.some((t) => isDoneOn(t, input.date));
}

export async function pickCatchUpDate(input: {
  today: string;
  lookBackDays?: number;
  hasLog: (date: string) => Promise<boolean>;
  hasTraces: (date: string) => Promise<boolean>;
}): Promise<string | null> {
  const n = input.lookBackDays ?? CATCH_UP_LOOKBACK_DAYS;
  for (let i = 1; i <= n; i++) {
    const date = shiftLocalDate(input.today, -i);
    if (await input.hasLog(date)) continue;
    if (await input.hasTraces(date)) return date;
  }
  return null;
}

export async function catchUpDiary(_input: {
  today: string;
  hasKey: boolean;
  getChat: (date: string) => Promise<DayChat>;
  listTodos: () => Promise<Todo[]>;
  getLog: (date: string) => Promise<DailyLog | null>;
  putLog: (log: DailyLog) => Promise<void>;
  compose: (date: string) => Promise<DailyLog>;
}): Promise<string | null> {
  return null;
}
