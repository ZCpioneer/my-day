import { normKey } from "@/norm";
import type {
  ParseResult,
  Project,
  ProposedTodo,
  TimelineEvent,
  Todo,
  Waiting,
} from "@/types";

export interface RouteDeps {
  addEvent: (e: TimelineEvent) => Promise<void>;
  upsertProject: (title: string, patch: { note?: string; status?: Project["status"] }) => Promise<void>;
  addWaiting: (w: Waiting) => Promise<void>;
  listOpenWaitings: () => Promise<Waiting[]>;
  resolveWaiting: (id: string) => Promise<void>;
  listTodos: () => Promise<Todo[]>;
  now: () => Date;
  newId: () => string;
}

export interface RouteOutcome {
  /** 去重后的待确认任务（确认后才落库）。 */
  proposedTasks: ProposedTodo[];
}

/** 解析产出的路由：事实自动落 Timeline/State；任务只返回候选，等用户确认。 */
export async function routeParseResult(
  result: ParseResult,
  opts: { date: string; messageId: string },
  deps: RouteDeps,
): Promise<RouteOutcome> {
  const createdAt = deps.now().toISOString();
  for (const text of result.events) {
    await deps.addEvent({ id: deps.newId(), date: opts.date, createdAt, kind: "event", text, fromMessageId: opts.messageId });
  }
  for (const text of result.decisions) {
    await deps.addEvent({ id: deps.newId(), date: opts.date, createdAt, kind: "decision", text, fromMessageId: opts.messageId });
  }
  for (const u of result.projectUpdates) {
    await deps.upsertProject(u.project, { note: u.note, status: u.status });
  }
  for (const w of result.waitings) {
    await deps.addWaiting({ id: deps.newId(), text: w.text, waitingOn: w.waitingOn, since: createdAt, fromMessageId: opts.messageId });
  }
  if (result.waitingsResolved.length > 0) {
    const open = await deps.listOpenWaitings();
    for (const text of result.waitingsResolved) {
      const key = normKey(text);
      const hit = open.find((w) => {
        const wk = normKey(w.text);
        return wk.includes(key) || key.includes(wk);
      });
      if (hit) await deps.resolveWaiting(hit.id);
    }
  }

  const todos = await deps.listTodos();
  const seenTodos = new Set(todos.map((t) => normKey(t.title)));
  const proposedTasks: ProposedTodo[] = [];
  for (const t of result.tasks) {
    const key = normKey(t.title);
    if (!key || seenTodos.has(key)) continue;
    seenTodos.add(key);
    proposedTasks.push({
      title: t.title,
      reason: t.reason,
      when: "later",
      priority: t.priority,
      due: t.due,
      project: t.project,
    });
  }

  return { proposedTasks };
}
