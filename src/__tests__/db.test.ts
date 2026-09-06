import { describe, it, expect, beforeEach } from "vitest";
import { chatRepo, deleteDb, eventRepo, logRepo, memoryRepo, projectRepo, todoRepo, waitingRepo } from "@/storage/db";
import type { ChatMessage, Todo, DailyLog } from "@/types";

beforeEach(async () => {
  await deleteDb();
});

describe("chatRepo", () => {
  it("starts a day empty and appends", async () => {
    const empty = await chatRepo.get("2026-09-05");
    expect(empty.messages).toEqual([]);
    const msg: ChatMessage = {
      id: "m1",
      role: "user",
      content: "开始今天。",
      createdAt: "2026-09-05T01:00:00.000Z",
      mode: "morning",
    };
    await chatRepo.append("2026-09-05", msg);
    const day = await chatRepo.get("2026-09-05");
    expect(day.messages).toHaveLength(1);
    expect(day.messages[0].content).toBe("开始今天。");
  });

  it("clears a day's conversation without touching todos", async () => {
    await chatRepo.append("2026-09-05", {
      id: "m1",
      role: "user",
      content: "开始今天。",
      createdAt: "2026-09-05T01:00:00.000Z",
      mode: "morning",
    });
    await todoRepo.add({
      id: "t1",
      title: "周报",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
    });
    await chatRepo.clear("2026-09-05");
    expect((await chatRepo.get("2026-09-05")).messages).toEqual([]);
    expect((await todoRepo.list()).map((t) => t.title)).toEqual(["周报"]);
  });

  it("closeSession archives visible messages and stamps the plan", async () => {
    await chatRepo.append("2026-09-05", {
      id: "m1",
      role: "user",
      content: "支付宝必须今天弄完",
      createdAt: "2026-09-05T01:00:00.000Z",
      mode: "chat",
    });
    await chatRepo.closeSession("2026-09-05", "2026-09-05T08:00:00.000Z");
    const day = await chatRepo.get("2026-09-05");
    expect(day.messages).toEqual([]);
    expect(day.archive?.map((m) => m.content)).toEqual(["支付宝必须今天弄完"]);
    expect(day.planConfirmedAt).toBe("2026-09-05T08:00:00.000Z");
  });

  it("keeps planConfirmedAt when appending messages", async () => {
    await chatRepo.setPlanConfirmed("2026-09-05", "2026-09-05T02:00:00.000Z");
    await chatRepo.append("2026-09-05", {
      id: "m1",
      role: "user",
      content: "自动整理。",
      createdAt: "2026-09-05T02:01:00.000Z",
      mode: "morning",
    });
    const day = await chatRepo.get("2026-09-05");
    expect(day.planConfirmedAt).toBe("2026-09-05T02:00:00.000Z");
    expect(day.messages).toHaveLength(1);
  });
});

describe("todoRepo", () => {
  it("adds and toggles without dropping other days", async () => {
    const a: Todo = {
      id: "t1",
      title: "给房东转水电费",
      status: "open",
      sourceDate: "2026-09-04",
      createdAt: "2026-09-04T01:00:00.000Z",
    };
    await todoRepo.add(a);
    const done = await todoRepo.toggle("t1", new Date("2026-09-05T12:00:00.000Z"));
    expect(done.status).toBe("done");
    expect(done.completedAt).toBe("2026-09-05T12:00:00.000Z");
    const listed = await todoRepo.list();
    expect(listed).toHaveLength(1);
  });

  it("removes a todo without touching the others", async () => {
    await todoRepo.add({
      id: "t1",
      title: "周报",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "later",
    });
    await todoRepo.add({
      id: "t2",
      title: "支付宝",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "today",
    });
    await todoRepo.remove("t1");
    expect((await todoRepo.list()).map((t) => t.title)).toEqual(["支付宝"]);
  });

  it("applyTodayPlan replaces today's set and persists when", async () => {
    await todoRepo.add({
      id: "t1",
      title: "支付宝",
      status: "open",
      sourceDate: "2026-09-04",
      createdAt: "2026-09-04T01:00:00.000Z",
      when: "later",
    });
    await todoRepo.add({
      id: "t2",
      title: "周报",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "today",
    });
    await todoRepo.applyTodayPlan(["支付宝"], new Date("2026-09-05T08:00:00.000Z"));
    const listed = await todoRepo.list();
    expect(listed.find((t) => t.title === "支付宝")?.when).toBe("today");
    expect(listed.find((t) => t.title === "周报")?.when).toBe("later");
  });

  it("applyFullPlan writes new later titles and keeps unmentioned later", async () => {
    await todoRepo.add({
      id: "t1",
      title: "周报",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "later",
    });
    await todoRepo.applyFullPlan(
      { today: ["支付宝"], later: ["买机票"] },
      new Date("2026-09-05T08:00:00.000Z"),
    );
    const listed = await todoRepo.list();
    expect(listed.find((t) => t.title === "支付宝")?.when).toBe("today");
    expect(listed.find((t) => t.title === "周报")?.when).toBe("later");
    expect(listed.find((t) => t.title === "买机票")?.when).toBe("later");
  });

  it("move reorders within a bucket by writing order", async () => {
    await todoRepo.add({
      id: "t1",
      title: "支付宝",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "today",
    });
    await todoRepo.add({
      id: "t2",
      title: "周报",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T02:00:00.000Z",
      when: "today",
    });
    await todoRepo.move("t2", "today", 0, new Date("2026-09-05T08:00:00.000Z"));
    const listed = await todoRepo.list();
    expect(listed.find((t) => t.id === "t2")).toMatchObject({ when: "today", order: 0 });
    expect(listed.find((t) => t.id === "t1")).toMatchObject({ when: "today", order: 1 });
  });

  it("move to the other bucket flips when without touching status", async () => {
    await todoRepo.add({
      id: "t1",
      title: "支付宝",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "today",
    });
    await todoRepo.move("t1", "later", 0, new Date("2026-09-05T08:00:00.000Z"));
    const moved = (await todoRepo.list()).find((t) => t.id === "t1");
    expect(moved).toMatchObject({ when: "later", order: 0, status: "open" });
    expect(moved?.completedAt).toBeUndefined();
  });

  it("move on a missing id is a no-op", async () => {
    await todoRepo.move("nope", "today", 0);
    expect(await todoRepo.list()).toEqual([]);
  });
});

describe("logRepo", () => {
  it("overwrites the same date", async () => {
    const first: DailyLog = {
      date: "2026-09-05",
      plan: "先调试",
      done: [],
      undone: ["周报"],
      state: "烦",
      updatedAt: "2026-09-05T12:00:00.000Z",
    };
    await logRepo.put(first);
    await logRepo.put({ ...first, state: "还行", updatedAt: "2026-09-05T13:00:00.000Z" });
    const got = await logRepo.get("2026-09-05");
    expect(got?.state).toBe("还行");
  });
});

describe("eventRepo", () => {
  it("listRecent 只返回近 N 天且按时间升序", async () => {
    const now = new Date(2026, 8, 6, 12, 0, 0);
    await eventRepo.add({ id: "e1", date: "2026-09-03", createdAt: "2026-09-03T02:00:00.000Z", kind: "event", text: "更早的事", fromMessageId: "m1" });
    await eventRepo.add({ id: "e2", date: "2026-09-06", createdAt: "2026-09-06T01:00:00.000Z", kind: "decision", text: "定了用 Postgres", fromMessageId: "m2" });
    await eventRepo.add({ id: "e3", date: "2026-09-05", createdAt: "2026-09-05T03:00:00.000Z", kind: "event", text: "昨天的事", fromMessageId: "m3" });
    const recent = await eventRepo.listRecent(3, now);
    expect(recent.map((e) => e.id)).toEqual(["e3", "e2"]);
  });
});

describe("projectRepo", () => {
  it("upsertByTitle 按归一化标题更新而不是新建", async () => {
    await projectRepo.upsertByTitle("朝暮 App", { note: "立项" }, new Date(2026, 8, 5));
    const again = await projectRepo.upsertByTitle("朝暮app", { note: "解析层联调完了" }, new Date(2026, 8, 6));
    const all = await projectRepo.list();
    expect(all).toHaveLength(1);
    expect(all[0].note).toBe("解析层联调完了");
    expect(again.id).toBe(all[0].id);
    expect(all[0].status).toBe("active");
  });
});

describe("waitingRepo", () => {
  it("解决后不再出现在 listOpen", async () => {
    await waitingRepo.add({ id: "w1", text: "等房东答复", waitingOn: "房东", since: "2026-09-06T01:00:00.000Z", fromMessageId: "m1" });
    expect((await waitingRepo.listOpen()).map((w) => w.id)).toEqual(["w1"]);
    await waitingRepo.resolve("w1", new Date(2026, 8, 6, 18, 0, 0));
    expect(await waitingRepo.listOpen()).toEqual([]);
  });
});

describe("memoryRepo", () => {
  it("增删查", async () => {
    await memoryRepo.add({ id: "mem1", text: "早上不开会", kind: "preference", createdAt: "2026-09-06T01:00:00.000Z" });
    expect((await memoryRepo.list()).map((m) => m.text)).toEqual(["早上不开会"]);
    await memoryRepo.remove("mem1");
    expect(await memoryRepo.list()).toEqual([]);
  });
});
