import { describe, expect, it } from "vitest";
import { chatCompletions } from "@/api/deepseek";
import { composeDailyLog } from "@/agent/compose-log";
import { DEFAULT_DEBUG_KEY } from "@/debug/default-key";
import type { Todo } from "@/types";

const key = process.env.DEEPSEEK_API_KEY ?? DEFAULT_DEBUG_KEY;
const model = process.env.EVAL_MODEL ?? "deepseek-v4-flash";

const postJson = async (url: string, headers: Record<string, string>, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as unknown };
};

const todos: Todo[] = [
  {
    id: "1",
    title: "给爸妈打电话",
    status: "done",
    sourceDate: "2026-09-08",
    createdAt: "2026-09-08T01:00:00.000Z",
    completedAt: "2026-09-08T11:30:00.000Z",
    when: "today",
  },
  {
    id: "2",
    title: "写完方案初稿",
    status: "open",
    sourceDate: "2026-09-08",
    createdAt: "2026-09-08T01:00:00.000Z",
    when: "today",
  },
];

describe.skipIf(!key)("日记情绪层 eval（真实 API，需 DEEPSEEK_API_KEY 或内置调试 Key）", () => {
  it("输出的日记带 mood（emoji）和 cheer（鼓励语）", async () => {
    const log = await composeDailyLog({
      date: "2026-09-08",
      now: new Date(2026, 8, 8, 21, 30, 0),
      chat: {
        date: "2026-09-08",
        messages: [
          { id: "m1", role: "user", content: "今天方案卡了一下午，有点烦", createdAt: "2026-09-08T06:00:00.000Z" },
          { id: "m2", role: "user", content: "刚给爸妈打完电话，聊得挺开心", createdAt: "2026-09-08T11:40:00.000Z" },
        ],
        planConfirmedAt: "2026-09-08T02:00:00.000Z",
      },
      todos,
      model,
      complete: (req) => chatCompletions({ apiKey: key, request: req, postJson }),
    });
    console.log("mood:", log.mood, "| cheer:", log.cheer, "| state:", log.state);
    expect(log.state.length).toBeGreaterThan(0);
    // 情绪层：mood 应为短 emoji（容错截到 8 字符内），cheer 应是一句话
    expect(log.mood).toBeTruthy();
    expect([...log.mood!].length).toBeLessThanOrEqual(8);
    expect(log.cheer).toBeTruthy();
    expect(log.cheer!.length).toBeLessThanOrEqual(120);
  });
});
