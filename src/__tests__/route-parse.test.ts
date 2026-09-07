import { describe, expect, it } from "vitest";
import { emptyParseResult } from "@/agent/parse";
import { routeParseResult, type RouteDeps } from "@/agent/route-parse";
import type { ProposedTodo, TimelineEvent, Todo, Waiting } from "@/types";

function makeDeps(over?: Partial<RouteDeps>) {
  const events: TimelineEvent[] = [];
  const projects: { title: string; note?: string; status?: string }[] = [];
  const waitings: Waiting[] = [];
  const resolved: string[] = [];
  const deps: RouteDeps = {
    addEvent: async (e) => {
      events.push(e);
    },
    upsertProject: async (title, patch) => {
      const hit = projects.find((p) => p.title === title);
      if (hit) Object.assign(hit, patch);
      else projects.push({ title, ...patch });
    },
    addWaiting: async (w) => {
      waitings.push(w);
    },
    listOpenWaitings: async () => waitings.filter((w) => !w.resolvedAt),
    resolveWaiting: async (id) => {
      resolved.push(id);
    },
    listTodos: async () => [],
    now: () => new Date(2026, 8, 6, 10, 0, 0),
    newId: (() => {
      let i = 0;
      return () => `id-${++i}`;
    })(),
    ...over,
  };
  return { deps, events, projects, waitings, resolved };
}

const OPTS = { date: "2026-09-06", messageId: "m1" };

describe("routeParseResult", () => {
  it("events/decisions 进 Timeline，projectUpdates 进项目，waitings 进等待", async () => {
    const { deps, events, projects, waitings } = makeDeps();
    const r = {
      ...emptyParseResult(),
      events: ["中午吃了螺蛳粉"],
      decisions: ["定了用 Postgres"],
      projectUpdates: [{ project: "日程秘书", note: "解析层联调完了" }],
      waitings: [{ text: "等房东答复", waitingOn: "房东" }],
    };
    const out = await routeParseResult(r, OPTS, deps);
    expect(events.map((e) => [e.kind, e.text])).toEqual([
      ["event", "中午吃了螺蛳粉"],
      ["decision", "定了用 Postgres"],
    ]);
    expect(events[0].fromMessageId).toBe("m1");
    expect(projects).toEqual([{ title: "日程秘书", note: "解析层联调完了" }]);
    expect(waitings.map((w) => w.text)).toEqual(["等房东答复"]);
    expect(out.proposedTasks).toEqual([]);
  });

  it("tasks 不落库，去重后返回待确认", async () => {
    const existing: Todo[] = [
      { id: "t1", title: "给妈妈回电话", status: "open", sourceDate: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z" },
    ];
    const { deps, events } = makeDeps({ listTodos: async () => existing });
    const r = {
      ...emptyParseResult(),
      tasks: [
        { title: "给妈妈回电话" },
        { title: "明天下午三点前交稿", priority: "high" as const, due: "2026-09-07", project: "接私活" },
        { title: " 给 妈妈 回电话 " },
      ],
    };
    const out = await routeParseResult(r, OPTS, deps);
    expect(events).toEqual([]);
    expect(out.proposedTasks).toEqual([
      { title: "明天下午三点前交稿", reason: undefined, when: "later", priority: "high", due: "2026-09-07", project: "接私活" },
    ] satisfies ProposedTodo[]);
  });

  it("estimate/reason 透传到待确认任务", async () => {
    const { deps } = makeDeps();
    const r = {
      ...emptyParseResult(),
      tasks: [{ title: "去银行办房贷", reason: "利率要重签", estimate: 90, project: "搬家" }],
    };
    const out = await routeParseResult(r, OPTS, deps);
    expect(out.proposedTasks).toEqual([
      { title: "去银行办房贷", reason: "利率要重签", when: "later", priority: undefined, due: undefined, estimate: 90, project: "搬家" },
    ] satisfies ProposedTodo[]);
  });

  it("waitingsResolved 按文本匹配解决等待", async () => {
    const { deps, waitings, resolved } = makeDeps();
    waitings.push({ id: "w1", text: "等房东答复房租", since: "2026-09-05T01:00:00.000Z", fromMessageId: "m0" });
    const r = { ...emptyParseResult(), waitingsResolved: ["房东答复房租"] };
    await routeParseResult(r, OPTS, deps);
    expect(resolved).toEqual(["w1"]);
  });

  it("waitingsResolved 匹配不上时不动", async () => {
    const { deps, waitings, resolved } = makeDeps();
    waitings.push({ id: "w1", text: "等出版社回邮件", since: "2026-09-05T01:00:00.000Z", fromMessageId: "m0" });
    const r = { ...emptyParseResult(), waitingsResolved: ["快递到了"] };
    await routeParseResult(r, OPTS, deps);
    expect(resolved).toEqual([]);
  });
});
