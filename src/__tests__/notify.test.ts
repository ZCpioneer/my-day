import { describe, expect, it } from "vitest";
import {
  DIARY_REMINDER_ID,
  planReminders,
  rescheduleReminders,
  type Notifier,
  type ReminderSpec,
} from "@/notify";
import type { Todo } from "@/types";

// 统一用本地时间构造（月 8 = 九月），与被测代码的本地语义对齐，不受跑测试的时区影响。
const NOW_10AM = new Date(2026, 8, 7, 10, 0, 0, 0);

function todo(partial: Partial<Todo> & { id: string; title: string }): Todo {
  return {
    status: "open",
    sourceDate: "2026-09-07",
    createdAt: "2026-09-07T00:00:00.000Z",
    when: "today",
    ...partial,
  };
}

function plan(todos: Todo[], opts?: { hasLogToday?: boolean; now?: Date }): ReminderSpec[] {
  return planReminders({ todos, hasLogToday: opts?.hasLogToday ?? true, now: opts?.now ?? NOW_10AM });
}

describe("planReminders：待办 due 提醒", () => {
  it("due 带具体时间且在未来：到点提醒，文案「该办了」", () => {
    const rs = plan([todo({ id: "a", title: "交稿子", due: "2026-09-07T15:00" })]);
    expect(rs).toHaveLength(1);
    expect(rs[0].at.getTime()).toBe(new Date(2026, 8, 7, 15, 0, 0, 0).getTime());
    expect(rs[0].title).toBe("该办了");
    expect(rs[0].body).toBe("交稿子");
  });

  it("due 只有日期：当天早上 9:00 提醒", () => {
    const rs = plan([todo({ id: "a", title: "买牛奶", due: "2026-09-07" })], {
      now: new Date(2026, 8, 7, 8, 0, 0, 0),
    });
    expect(rs).toHaveLength(1);
    expect(rs[0].at.getTime()).toBe(new Date(2026, 8, 7, 9, 0, 0, 0).getTime());
  });

  it("due 只有日期但当天 9:00 已过：跳过", () => {
    expect(plan([todo({ id: "a", title: "买牛奶", due: "2026-09-07" })])).toEqual([]);
  });

  it("due 带的时间点已过：跳过", () => {
    expect(plan([todo({ id: "a", title: "交稿子", due: "2026-09-07T08:30" })])).toEqual([]);
  });

  it("due 在明天：照常提醒（明天 9:00 / 明天到点）", () => {
    const rs = plan([
      todo({ id: "a", title: "买机票", due: "2026-09-08" }),
      todo({ id: "b", title: "开会", due: "2026-09-08T14:30:00" }),
    ]);
    expect(rs.map((r) => r.at.getTime())).toEqual([
      new Date(2026, 8, 8, 9, 0, 0, 0).getTime(),
      new Date(2026, 8, 8, 14, 30, 0, 0).getTime(),
    ]);
  });

  it("已完成的待办跳过", () => {
    const rs = plan([
      todo({ id: "a", title: "交稿子", due: "2026-09-07T15:00", status: "done", completedAt: "2026-09-07T09:00:00.000Z" }),
    ]);
    expect(rs).toEqual([]);
  });

  it("「以后」桶带未来 due 也提醒；when 缺失视为 today 照常提醒", () => {
    const rs = plan([
      todo({ id: "a", title: "以后再说", due: "2026-09-07T15:00", when: "later" }),
      todo({ id: "b", title: "没写桶", due: "2026-09-07T16:00", when: undefined }),
    ]);
    expect(rs.map((r) => r.body)).toEqual(["以后再说", "没写桶"]);
  });

  it("已逾期且当天 9:00 还没到：早上 9 点再催一次", () => {
    const rs = plan([todo({ id: "a", title: "过期稿", due: "2026-09-06", when: "later" })], {
      now: new Date(2026, 8, 7, 8, 0, 0, 0),
    });
    expect(rs).toHaveLength(1);
    expect(rs[0].at.getTime()).toBe(new Date(2026, 8, 7, 9, 0, 0, 0).getTime());
    expect(rs[0].title).toBe("已逾期");
    expect(rs[0].body).toBe("过期稿");
  });

  it("due 格式非法：跳过不炸", () => {
    expect(plan([todo({ id: "a", title: "交稿子", due: "下周再说" })])).toEqual([]);
  });

  it("空格分隔的日期时间也认", () => {
    const rs = plan([todo({ id: "a", title: "交稿子", due: "2026-09-07 15:00" })]);
    expect(rs[0].at.getTime()).toBe(new Date(2026, 8, 7, 15, 0, 0, 0).getTime());
  });

  it("通知 id 稳定且不与日记提醒撞段", () => {
    const t = todo({ id: "a", title: "交稿子", due: "2026-09-07T15:00" });
    const first = plan([t])[0].id;
    expect(plan([t])[0].id).toBe(first);
    expect(first).not.toBe(DIARY_REMINDER_ID);
    expect(Number.isInteger(first)).toBe(true);
  });
});

describe("planReminders：晚间日记提醒", () => {
  it("今天没写日记：今晚 21:00 提醒", () => {
    const rs = plan([], { hasLogToday: false });
    expect(rs).toHaveLength(1);
    expect(rs[0].id).toBe(DIARY_REMINDER_ID);
    expect(rs[0].at.getTime()).toBe(new Date(2026, 8, 7, 21, 0, 0, 0).getTime());
    expect(rs[0].title).toBe("今天还没写日记");
    expect(rs[0].body).toBe("和秘书聊聊今天吧");
  });

  it("今天已写日记：不出", () => {
    expect(plan([], { hasLogToday: true })).toEqual([]);
  });

  it("21:00 已过：跳过", () => {
    expect(plan([], { hasLogToday: false, now: new Date(2026, 8, 7, 21, 30, 0, 0) })).toEqual([]);
  });

  it("混合场景：未来 due + 过期 due + 无日记 → 各归各", () => {
    const rs = plan(
      [
        todo({ id: "a", title: "交稿子", due: "2026-09-07T15:00" }),
        todo({ id: "b", title: "过期的", due: "2026-09-07T08:00" }),
      ],
      { hasLogToday: false },
    );
    expect(rs.map((r) => r.body)).toEqual(["交稿子", "和秘书聊聊今天吧"]);
  });
});

describe("rescheduleReminders：先全清再全量挂", () => {
  function recordingNotifier(granted = true) {
    const calls: string[] = [];
    const notifier: Notifier = {
      requestPermission: async () => {
        calls.push("requestPermission");
        return granted;
      },
      cancelAll: async () => {
        calls.push("cancelAll");
      },
      schedule: async (rs) => {
        calls.push(`schedule:${rs.map((r) => r.body).join("/")}`);
      },
    };
    return { calls, notifier };
  }

  it("有提醒：cancelAll → requestPermission → schedule", async () => {
    const { calls, notifier } = recordingNotifier();
    await rescheduleReminders(notifier, {
      todos: [todo({ id: "a", title: "交稿子", due: "2026-09-07T15:00" })],
      hasLogToday: true,
      now: NOW_10AM,
    });
    expect(calls).toEqual(["cancelAll", "requestPermission", "schedule:交稿子"]);
  });

  it("没有要挂的提醒：只 cancelAll，不请求权限", async () => {
    const { calls, notifier } = recordingNotifier();
    await rescheduleReminders(notifier, { todos: [], hasLogToday: true, now: NOW_10AM });
    expect(calls).toEqual(["cancelAll"]);
  });

  it("权限被拒绝：cancelAll + requestPermission，不 schedule", async () => {
    const { calls, notifier } = recordingNotifier(false);
    await rescheduleReminders(notifier, { todos: [], hasLogToday: false, now: NOW_10AM });
    expect(calls).toEqual(["cancelAll", "requestPermission"]);
  });
});
