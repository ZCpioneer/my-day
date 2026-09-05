import { localDate } from "./dates";
import type { Todo } from "./types";

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function todoWhen(t: Pick<Todo, "when">): "today" | "later" {
  return t.when === "later" ? "later" : "today";
}

export function isDoneOn(t: Todo, date: string): boolean {
  return t.status === "done" && !!t.completedAt && localDate(new Date(t.completedAt)) === date;
}

export function partitionTodos(todos: Todo[], date: string): {
  today: Todo[];
  later: Todo[];
  doneToday: Todo[];
} {
  const today: Todo[] = [];
  const later: Todo[] = [];
  const doneToday: Todo[] = [];
  for (const t of todos) {
    if (isDoneOn(t, date)) {
      doneToday.push(t);
      continue;
    }
    if (t.status !== "open") continue;
    if (todoWhen(t) === "today") today.push(t);
    else later.push(t);
  }
  return { today, later, doneToday };
}

export function snapshotLogTitles(todos: Todo[], date: string): { done: string[]; undone: string[] } {
  const { today, doneToday } = partitionTodos(todos, date);
  return {
    undone: today.map((t) => t.title),
    done: doneToday.filter((t) => todoWhen(t) === "today").map((t) => t.title),
  };
}

export function applyTodayPlan(
  existing: Todo[],
  titles: string[],
  opts: { date: string; nowIso: string; newId: () => string },
): Todo[] {
  const wanted = titles.map((t) => t.trim()).filter(Boolean);
  const wantedNorm = new Set(wanted.map(norm));
  const next = existing.map((t) => ({ ...t }));

  for (const t of next) {
    if (t.status !== "open") continue;
    if (wantedNorm.has(norm(t.title))) t.when = "today";
    else if (todoWhen(t) === "today") t.when = "later";
  }

  const existingNorm = new Set(next.map((t) => norm(t.title)));
  for (const title of wanted) {
    if (existingNorm.has(norm(title))) continue;
    next.push({
      id: opts.newId(),
      title,
      status: "open",
      sourceDate: opts.date,
      createdAt: opts.nowIso,
      when: "today",
    });
    existingNorm.add(norm(title));
  }
  return next;
}
