import { describe, it, expect, beforeEach } from "vitest";
import { chatRepo, todoRepo, logRepo, deleteDb } from "@/storage/db";
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
