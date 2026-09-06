import { closeVisibleSession } from "../chat-session";
import { newId } from "../ids";
import { applyFullPlan, applyMove, applyTodayPlan } from "../todos";
import { localDate, shiftLocalDate } from "../dates";
import { normKey } from "../norm";
import type { ChatMessage, DailyLog, DayChat, Memory, Project, TimelineEvent, Todo, Waiting } from "../types";

const DB_NAME = "zhaomu";
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("chats")) db.createObjectStore("chats", { keyPath: "date" });
      if (!db.objectStoreNames.contains("todos")) db.createObjectStore("todos", { keyPath: "id" });
      if (!db.objectStoreNames.contains("logs")) db.createObjectStore("logs", { keyPath: "date" });
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "id" });
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("waitings")) db.createObjectStore("waitings", { keyPath: "id" });
      if (!db.objectStoreNames.contains("memories")) db.createObjectStore("memories", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export const chatRepo = {
  async get(date: string): Promise<DayChat> {
    const db = await openDb();
    const row = await new Promise<DayChat | undefined>((resolve, reject) => {
      const req = db.transaction("chats").objectStore("chats").get(date);
      req.onsuccess = () => resolve(req.result as DayChat | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return row ?? { date, messages: [] };
  },
  async append(date: string, msg: ChatMessage): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("chats", "readwrite");
    const store = tx.objectStore("chats");
    const current = await new Promise<DayChat>((resolve, reject) => {
      const req = store.get(date);
      req.onsuccess = () => resolve((req.result as DayChat) ?? { date, messages: [] });
      req.onerror = () => reject(req.error);
    });
    current.messages.push(msg);
    store.put(current);
    await txDone(tx);
    db.close();
  },
  async setPlanConfirmed(date: string, at: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("chats", "readwrite");
    const store = tx.objectStore("chats");
    const current = await new Promise<DayChat>((resolve, reject) => {
      const req = store.get(date);
      req.onsuccess = () => resolve((req.result as DayChat) ?? { date, messages: [] });
      req.onerror = () => reject(req.error);
    });
    current.planConfirmedAt = at;
    store.put(current);
    await txDone(tx);
    db.close();
  },
  async clear(date: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("chats", "readwrite");
    tx.objectStore("chats").put({ date, messages: [] });
    await txDone(tx);
    db.close();
  },
  async closeSession(date: string, planConfirmedAt?: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("chats", "readwrite");
    const store = tx.objectStore("chats");
    const current = await new Promise<DayChat>((resolve, reject) => {
      const req = store.get(date);
      req.onsuccess = () => resolve((req.result as DayChat) ?? { date, messages: [] });
      req.onerror = () => reject(req.error);
    });
    store.put(closeVisibleSession(current, planConfirmedAt));
    await txDone(tx);
    db.close();
  },
};

export const todoRepo = {
  async list(): Promise<Todo[]> {
    const db = await openDb();
    const rows = await new Promise<Todo[]>((resolve, reject) => {
      const req = db.transaction("todos").objectStore("todos").getAll();
      req.onsuccess = () => resolve(req.result as Todo[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  },
  async add(todo: Todo): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    tx.objectStore("todos").put(todo);
    await txDone(tx);
    db.close();
  },
  async toggle(id: string, now: Date = new Date()): Promise<Todo> {
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    const todo = await new Promise<Todo>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as Todo);
      req.onerror = () => reject(req.error);
    });
    if (!todo) throw new Error("todo not found");
    if (todo.status === "open") {
      todo.status = "done";
      todo.completedAt = now.toISOString();
    } else {
      todo.status = "open";
      delete todo.completedAt;
    }
    store.put(todo);
    await txDone(tx);
    db.close();
    return todo;
  },
  async remove(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    tx.objectStore("todos").delete(id);
    await txDone(tx);
    db.close();
  },
  async move(id: string, when: "today" | "later", index: number, now: Date = new Date()): Promise<void> {
    const existing = await todoRepo.list();
    const next = applyMove(existing, id, { when, index }, localDate(now));
    if (next === existing) return;
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    for (const todo of next) store.put(todo);
    await txDone(tx);
    db.close();
  },
  async applyTodayPlan(titles: string[], now: Date = new Date()): Promise<void> {
    const date = localDate(now);
    const existing = await todoRepo.list();
    const next = applyTodayPlan(existing, titles, {
      date,
      nowIso: now.toISOString(),
      newId,
    });
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    for (const todo of next) store.put(todo);
    await txDone(tx);
    db.close();
  },
  async applyFullPlan(
    plan: { today: string[]; later: string[] },
    now: Date = new Date(),
  ): Promise<void> {
    const date = localDate(now);
    const existing = await todoRepo.list();
    const next = applyFullPlan(existing, plan, {
      date,
      nowIso: now.toISOString(),
      newId,
    });
    const db = await openDb();
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    for (const todo of next) store.put(todo);
    await txDone(tx);
    db.close();
  },
};

export const logRepo = {
  async get(date: string): Promise<DailyLog | null> {
    const db = await openDb();
    const row = await new Promise<DailyLog | undefined>((resolve, reject) => {
      const req = db.transaction("logs").objectStore("logs").get(date);
      req.onsuccess = () => resolve(req.result as DailyLog | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return row ?? null;
  },
  async put(log: DailyLog): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("logs", "readwrite");
    tx.objectStore("logs").put(log);
    await txDone(tx);
    db.close();
  },
};

export const eventRepo = {
  async add(e: TimelineEvent): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("events", "readwrite");
    tx.objectStore("events").put(e);
    await txDone(tx);
    db.close();
  },
  async listRecent(days: number, now: Date = new Date()): Promise<TimelineEvent[]> {
    const db = await openDb();
    const rows = await new Promise<TimelineEvent[]>((resolve, reject) => {
      const req = db.transaction("events").objectStore("events").getAll();
      req.onsuccess = () => resolve(req.result as TimelineEvent[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const since = shiftLocalDate(localDate(now), -(days - 1));
    return rows
      .filter((e) => e.date >= since)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  },
};

export const projectRepo = {
  async list(): Promise<Project[]> {
    const db = await openDb();
    const rows = await new Promise<Project[]>((resolve, reject) => {
      const req = db.transaction("projects").objectStore("projects").getAll();
      req.onsuccess = () => resolve(req.result as Project[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  },
  async upsertByTitle(
    title: string,
    patch: { note?: string; status?: Project["status"] },
    now: Date = new Date(),
  ): Promise<Project> {
    const key = normKey(title);
    const existing = (await projectRepo.list()).find((p) => normKey(p.title) === key);
    const nowIso = now.toISOString();
    const next: Project = existing
      ? {
          ...existing,
          note: patch.note ?? existing.note,
          status: patch.status ?? existing.status,
          updatedAt: nowIso,
        }
      : {
          id: newId(),
          title: title.trim(),
          status: patch.status ?? "active",
          note: patch.note,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
    const db = await openDb();
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(next);
    await txDone(tx);
    db.close();
    return next;
  },
};

export const waitingRepo = {
  async add(w: Waiting): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("waitings", "readwrite");
    tx.objectStore("waitings").put(w);
    await txDone(tx);
    db.close();
  },
  async listOpen(): Promise<Waiting[]> {
    const db = await openDb();
    const rows = await new Promise<Waiting[]>((resolve, reject) => {
      const req = db.transaction("waitings").objectStore("waitings").getAll();
      req.onsuccess = () => resolve(req.result as Waiting[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.filter((w) => !w.resolvedAt);
  },
  async resolve(id: string, now: Date = new Date()): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("waitings", "readwrite");
    const store = tx.objectStore("waitings");
    const w = await new Promise<Waiting | undefined>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as Waiting | undefined);
      req.onerror = () => reject(req.error);
    });
    if (w) {
      w.resolvedAt = now.toISOString();
      store.put(w);
    }
    await txDone(tx);
    db.close();
  },
};

export const memoryRepo = {
  async add(m: Memory): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("memories", "readwrite");
    tx.objectStore("memories").put(m);
    await txDone(tx);
    db.close();
  },
  async list(): Promise<Memory[]> {
    const db = await openDb();
    const rows = await new Promise<Memory[]>((resolve, reject) => {
      const req = db.transaction("memories").objectStore("memories").getAll();
      req.onsuccess = () => resolve(req.result as Memory[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  },
  async remove(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("memories", "readwrite");
    tx.objectStore("memories").delete(id);
    await txDone(tx);
    db.close();
  },
};
