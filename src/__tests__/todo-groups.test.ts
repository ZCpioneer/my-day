import { describe, it, expect } from "vitest";
import { sortProjects, partitionLater, syncProjectStatuses, applyProjectMove } from "@/todo-groups";
import type { Project, Todo } from "@/types";

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: partial.id,
    status: "open",
    sourceDate: "2026-09-06",
    createdAt: "2026-09-06T01:00:00.000Z",
    ...partial,
  };
}

function project(partial: Partial<Project> & { id: string }): Project {
  return {
    title: partial.id,
    status: "active",
    createdAt: "2026-09-06T01:00:00.000Z",
    updatedAt: "2026-09-06T01:00:00.000Z",
    ...partial,
  };
}

describe("sortProjects", () => {
  it("有 order 的在前，缺失按 createdAt 兜底；done 组沉底", () => {
    const ps = [
      project({ id: "c", createdAt: "2026-09-03T00:00:00.000Z" }),
      project({ id: "a", order: 1 }),
      project({ id: "done1", status: "done", order: 0 }),
      project({ id: "b", order: 0 }),
    ];
    expect(sortProjects(ps).map((p) => p.id)).toEqual(["b", "a", "c", "done1"]);
  });
});

describe("partitionLater", () => {
  it("组内只放 when=later 的未完成任务，进度含历史已完成", () => {
    const ps = [project({ id: "p1" })];
    const ts = [
      todo({ id: "t1", projectId: "p1", when: "later" }),
      todo({ id: "t2", projectId: "p1", when: "today" }),
      todo({ id: "t3", projectId: "p1", status: "done", completedAt: "2026-09-01T01:00:00.000Z" }),
    ];
    const [s] = partitionLater(ts, ps);
    expect(s.project?.id).toBe("p1");
    expect(s.todos.map((t) => t.id)).toEqual(["t1"]);
    expect(s.doneCount).toBe(1);
    expect(s.totalCount).toBe(3);
  });

  it("未分组区在进行中组之后、已完成组之前；无进行中组时排最前", () => {
    const ps = [project({ id: "p1" }), project({ id: "p2", status: "done" })];
    const ts = [
      todo({ id: "t1", projectId: "p1", when: "later" }),
      todo({ id: "t9", when: "later" }),
      todo({ id: "t8", projectId: "p2", status: "done", completedAt: "2026-09-01T01:00:00.000Z" }),
    ];
    const keys = partitionLater(ts, ps).map((s) => s.project?.id ?? "ungrouped");
    expect(keys).toEqual(["p1", "ungrouped", "p2"]);
  });

  it("已完成组没有未完成任务也显示（沉底）；进行中组没有以后任务则不显示", () => {
    const ps = [project({ id: "p1" }), project({ id: "p2", status: "done" })];
    const ts = [
      todo({ id: "t1", projectId: "p1", when: "today" }),
      todo({ id: "t2", projectId: "p2", status: "done", completedAt: "2026-09-01T01:00:00.000Z" }),
    ];
    const keys = partitionLater(ts, ps).map((s) => s.project?.id ?? "ungrouped");
    expect(keys).toEqual(["p2"]);
  });

  it("projectId 指向不存在的组时进未分组区", () => {
    const ts = [todo({ id: "t1", projectId: "ghost", when: "later" })];
    const [s] = partitionLater(ts, []);
    expect(s.project).toBeNull();
    expect(s.todos.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("syncProjectStatuses", () => {
  it("active 组最后一条 open 勾掉后自动 done", () => {
    const ps = [project({ id: "p1" })];
    const ts = [todo({ id: "t1", projectId: "p1", status: "done", completedAt: "2026-09-06T02:00:00.000Z" })];
    const [p] = syncProjectStatuses(ps, ts, "2026-09-06T03:00:00.000Z");
    expect(p.status).toBe("done");
    expect(p.updatedAt).toBe("2026-09-06T03:00:00.000Z");
  });

  it("没有任何任务的 active 组不自动 done", () => {
    const [p] = syncProjectStatuses([project({ id: "p1" })], [], "2026-09-06T03:00:00.000Z");
    expect(p.status).toBe("active");
  });

  it("done 组来了 open 任务自动重激活", () => {
    const ps = [project({ id: "p1", status: "done" })];
    const ts = [todo({ id: "t1", projectId: "p1" })];
    const [p] = syncProjectStatuses(ps, ts, "2026-09-06T03:00:00.000Z");
    expect(p.status).toBe("active");
  });

  it("paused 组不自动流转；无变化的组返回原引用", () => {
    const paused = project({ id: "p1", status: "paused" });
    const ts = [todo({ id: "t1", projectId: "p1", status: "done", completedAt: "2026-09-06T02:00:00.000Z" })];
    const [p] = syncProjectStatuses([paused], ts, "2026-09-06T03:00:00.000Z");
    expect(p).toBe(paused);
  });
});

describe("applyProjectMove", () => {
  it("在非 done 组序列里重排，重写 order 为 0..n-1", () => {
    const ps = [project({ id: "a" }), project({ id: "b" }), project({ id: "c" })];
    const next = applyProjectMove(ps, "a", 2);
    expect(next.find((p) => p.id === "b")?.order).toBe(0);
    expect(next.find((p) => p.id === "c")?.order).toBe(1);
    expect(next.find((p) => p.id === "a")?.order).toBe(2);
  });

  it("index 夹紧到序列范围；done 组不可拖、找不到 id 原样返回", () => {
    const ps = [project({ id: "a" }), project({ id: "b", status: "done" })];
    expect(applyProjectMove(ps, "b", 0)).toBe(ps);
    expect(applyProjectMove(ps, "ghost", 0)).toBe(ps);
    const next = applyProjectMove(ps, "a", 99);
    expect(next.find((p) => p.id === "a")?.order).toBe(0);
  });
});
