import { describe, it, expect, beforeEach } from "vitest";
import { chatRepo, deleteDb, eventRepo, logRepo, projectRepo, todoRepo, waitingRepo, weeklyRepo } from "@/storage/db";
import type { ChatMessage, Todo, DailyLog, WeeklyLog } from "@/types";

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
    await todoRepo.move("t2", "today", 0, undefined, new Date("2026-09-05T08:00:00.000Z"));
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
    await todoRepo.move("t1", "later", 0, undefined, new Date("2026-09-05T08:00:00.000Z"));
    const moved = (await todoRepo.list()).find((t) => t.id === "t1");
    expect(moved).toMatchObject({ when: "later", order: 0, status: "open" });
    expect(moved?.completedAt).toBeUndefined();
  });

  it("move on a missing id is a no-op", async () => {
    await todoRepo.move("nope", "today", 0);
    expect(await todoRepo.list()).toEqual([]);
  });

  it("update 改标题和截止，null 清掉可选字段", async () => {
    await todoRepo.add({
      id: "t1",
      title: "旧名",
      status: "open",
      sourceDate: "2026-09-05",
      createdAt: "2026-09-05T01:00:00.000Z",
      when: "later",
      due: "2026-09-08",
      priority: "high",
    });
    await todoRepo.update("t1", { title: "新名", when: "today", due: null, priority: null });
    const row = (await todoRepo.list()).find((t) => t.id === "t1");
    expect(row).toMatchObject({ title: "新名", when: "today" });
    expect(row?.due).toBeUndefined();
    expect(row?.priority).toBeUndefined();
  });
});

describe("logRepo", () => {
  it("overwrites the same date", async () => {
    const first: DailyLog = {
      date: "2026-09-05",
      state: "烦",
      updatedAt: "2026-09-05T12:00:00.000Z",
    };
    await logRepo.put(first);
    await logRepo.put({ ...first, state: "还行", updatedAt: "2026-09-05T13:00:00.000Z" });
    const got = await logRepo.get("2026-09-05");
    expect(got?.state).toBe("还行");
  });

  it("list returns every log newest first", async () => {
    expect(await logRepo.list()).toEqual([]);
    const mk = (date: string): DailyLog => ({
      date,
      state: "还行",
      updatedAt: `${date}T12:00:00.000Z`,
    });
    await logRepo.put(mk("2026-09-05"));
    await logRepo.put(mk("2026-09-03"));
    await logRepo.put(mk("2026-09-04"));
    expect((await logRepo.list()).map((l) => l.date)).toEqual(["2026-09-05", "2026-09-04", "2026-09-03"]);
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
    await projectRepo.upsertByTitle("日程秘书 App", { note: "立项" }, new Date(2026, 8, 5));
    const again = await projectRepo.upsertByTitle("日程秘书app", { note: "解析层联调完了" }, new Date(2026, 8, 6));
    const all = await projectRepo.list();
    expect(all).toHaveLength(1);
    expect(all[0].note).toBe("解析层联调完了");
    expect(again.id).toBe(all[0].id);
    expect(all[0].status).toBe("active");
  });

  it("remove 删掉组", async () => {
    const p = await projectRepo.upsertByTitle("搬家", {});
    await projectRepo.remove(p.id);
    expect(await projectRepo.list()).toEqual([]);
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

describe("todoRepo.move 带目标组 / setProject", () => {
  it("move 带 projectId 会改归属", async () => {
    await deleteDb();
    await todoRepo.add({
      id: "a1", title: "a1", status: "open", sourceDate: "2026-09-06",
      createdAt: "2026-09-06T01:00:00.000Z", when: "later", projectId: "p1",
    });
    await todoRepo.move("a1", "later", 0, { projectId: "p2" }, new Date("2026-09-06T08:00:00.000Z"));
    const t = (await todoRepo.list()).find((x) => x.id === "a1")!;
    expect(t.projectId).toBe("p2");
  });

  it("setProject 设置与清除；找不到抛错", async () => {
    await deleteDb();
    await todoRepo.add({
      id: "a1", title: "a1", status: "open", sourceDate: "2026-09-06",
      createdAt: "2026-09-06T01:00:00.000Z", when: "later",
    });
    await todoRepo.setProject("a1", "p1");
    expect((await todoRepo.list())[0].projectId).toBe("p1");
    await todoRepo.setProject("a1", null);
    expect("projectId" in (await todoRepo.list())[0]).toBe(false);
    await expect(todoRepo.setProject("ghost", "p1")).rejects.toThrow("todo not found");
  });
});

describe("projectRepo.put / move", () => {
  it("put 直写；move 重写非 done 组 order", async () => {
    await deleteDb();
    const a = await projectRepo.upsertByTitle("甲", {});
    const b = await projectRepo.upsertByTitle("乙", {});
    await projectRepo.put({ ...b, note: "进展" });
    expect((await projectRepo.list()).find((p) => p.id === b.id)?.note).toBe("进展");
    await projectRepo.move(b.id, 0);
    const list = await projectRepo.list();
    expect(list.find((p) => p.id === b.id)?.order).toBe(0);
    expect(list.find((p) => p.id === a.id)?.order).toBe(1);
  });
});

function mkWeekly(week: string, done: string): WeeklyLog {
  return {
    week,
    from: "2026-09-07",
    to: "2026-09-13",
    done,
    undone: "剩一点",
    next: "下周继续",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
}

describe("weeklyRepo", () => {
  it("put 后 get 拿到；同周键覆盖", async () => {
    expect(await weeklyRepo.get("2026-W37")).toBeNull();
    await weeklyRepo.put(mkWeekly("2026-W37", "第一版"));
    expect((await weeklyRepo.get("2026-W37"))?.done).toBe("第一版");
    await weeklyRepo.put(mkWeekly("2026-W37", "重生成"));
    expect((await weeklyRepo.get("2026-W37"))?.done).toBe("重生成");
  });

  it("list 按周键倒序", async () => {
    expect(await weeklyRepo.list()).toEqual([]);
    await weeklyRepo.put(mkWeekly("2026-W35", "甲"));
    await weeklyRepo.put(mkWeekly("2026-W37", "乙"));
    await weeklyRepo.put(mkWeekly("2026-W36", "丙"));
    expect((await weeklyRepo.list()).map((w) => w.week)).toEqual(["2026-W37", "2026-W36", "2026-W35"]);
  });
});

describe("v1 → v2 迁移", () => {
  it("老库升级后 v1 数据原样保留，weekly store 可用", async () => {
    // 先以 v1 结构建库并写入数据（模拟升级前一直在用的老库）。
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("ai-secretary", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("chats", { keyPath: "date" });
        db.createObjectStore("todos", { keyPath: "id" });
        db.createObjectStore("logs", { keyPath: "date" });
        db.createObjectStore("events", { keyPath: "id" });
        db.createObjectStore("projects", { keyPath: "id" });
        db.createObjectStore("waitings", { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["logs", "todos"], "readwrite");
        tx.objectStore("logs").put({
          // 旧版日记还带 plan/done/undone 字段；新结构不再读它们，升级后要能正常取出。
          date: "2026-09-01",
          plan: "老日记",
          done: ["旧事项"],
          undone: [],
          state: "还行",
          updatedAt: "2026-09-01T12:00:00.000Z",
        });
        tx.objectStore("todos").put({
          id: "old-1",
          title: "老待办",
          status: "open",
          sourceDate: "2026-09-01",
          createdAt: "2026-09-01T01:00:00.000Z",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    // repo 以 v2 打开，触发 onupgradeneeded（oldVersion=1，只补 weekly store）。
    expect((await logRepo.get("2026-09-01"))?.state).toBe("还行");
    expect((await todoRepo.list()).map((t) => t.title)).toEqual(["老待办"]);
    await weeklyRepo.put(mkWeekly("2026-W36", "升级后能用"));
    expect((await weeklyRepo.get("2026-W36"))?.done).toBe("升级后能用");
  });
});
