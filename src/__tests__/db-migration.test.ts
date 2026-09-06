import { describe, expect, it } from "vitest";
import { deleteDb, eventRepo, todoRepo } from "@/storage/db";

// 模拟旧版本：手工以 v1 建库（只有 chats/todos/logs），写一条待办。
async function createV1WithTodo() {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("zhaomu", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("chats", { keyPath: "date" });
      db.createObjectStore("todos", { keyPath: "id" });
      db.createObjectStore("logs", { keyPath: "date" });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("todos", "readwrite");
      tx.objectStore("todos").put({
        id: "old-1",
        title: "旧版本留下的待办",
        status: "open",
        sourceDate: "2026-09-05",
        createdAt: "2026-09-05T01:00:00.000Z",
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("db v1 → v2 迁移", () => {
  it("旧数据保留，新 store 可用", async () => {
    await deleteDb();
    await createV1WithTodo();
    const todos = await todoRepo.list();
    expect(todos.map((t) => t.title)).toContain("旧版本留下的待办");
    expect(todos[0].priority).toBeUndefined();
    await expect(eventRepo.listRecent(3)).resolves.toEqual([]);
  });
});
