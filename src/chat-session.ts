import type { DayChat } from "./types";

export function closeVisibleSession(chat: DayChat, planConfirmedAt?: string): DayChat {
  const archive = chat.messages.length > 0 ? [...(chat.archive ?? []), ...chat.messages] : [...(chat.archive ?? [])];
  const next: DayChat = { date: chat.date, messages: [] };
  if (archive.length > 0) next.archive = archive;
  const at = planConfirmedAt ?? chat.planConfirmedAt;
  if (at) next.planConfirmedAt = at;
  return next;
}

export function shouldGreet(chat: DayChat): boolean {
  if (chat.planConfirmedAt) return false;
  if (chat.messages.length > 0) return false;
  return (chat.archive?.length ?? 0) === 0;
}

export function sessionTranscript(messages: DayChat["messages"]): string {
  if (messages.length === 0) return "（当前这段没有对话）";
  return messages.map((m) => `${m.role === "user" ? "我" : "朝暮"}：${m.content}`).join("\n");
}

export function dayTranscript(chat: DayChat): string {
  const all = [...(chat.archive ?? []), ...chat.messages];
  if (all.length === 0) return "（当天没有对话）";
  return sessionTranscript(all);
}
