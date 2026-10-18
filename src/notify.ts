import { isOverdue } from "./todo-meta";
import { localDate } from "./dates";
import type { Todo } from "./types";

/** 一条本地通知的调度规格（纯数据；副作用全由 Notifier 执行）。 */
export interface ReminderSpec {
  /** 稳定整数 id：重排时先全清再全量挂，碰撞无所谓。 */
  id: number;
  /** 触发时间（本地）。 */
  at: Date;
  /** 通知标题（主文案）。 */
  title: string;
  /** 通知正文（副文案）。 */
  body: string;
}

/** 本地通知的副作用出口：原生端由 Capacitor 封装实现，web/测试用 noopNotifier。 */
export interface Notifier {
  /** 懒请求通知权限，返回是否已获授权。 */
  requestPermission(): Promise<boolean>;
  cancelAll(): Promise<void>;
  schedule(reminders: ReminderSpec[]): Promise<void>;
}

/** web/测试环境的空实现。 */
export const noopNotifier: Notifier = {
  requestPermission: async () => false,
  cancelAll: async () => {},
  schedule: async () => {},
};

/** due 只有日期时的提醒时刻：当天早上 9 点。 */
export const DUE_REMINDER_HOUR = 9;
/** 晚间日记提醒时刻：当晚 21 点。 */
export const DIARY_REMINDER_HOUR = 21;

// 通知 id 分配：1 固定给晚间日记提醒；待办提醒用 todo id 的 djb2 哈希（+2 保证不撞日记段）。
// 调度策略是先 cancelAll 再全量 schedule，所以哈希碰撞无所谓。
export const DIARY_REMINDER_ID = 1;

function reminderIdForTodo(todoId: string): number {
  let h = 5381;
  for (let i = 0; i < todoId.length; i++) h = ((h << 5) + h + todoId.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1_000_000_000) + 2;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

// due 是 ISO 日期或日期时间（见 types.ts）。纯日期 → 当天 9:00；带时间 → 到点。
// 不带时区的按本地时间拼（new Date("YYYY-MM-DD") 会被当成 UTC，必须绕开）；解析不了返回 null。
function dueReminderTime(due: string): Date | null {
  const s = due.trim();
  const d = DATE_ONLY.exec(s);
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), DUE_REMINDER_HOUR, 0, 0, 0);
  const dt = LOCAL_DATE_TIME.exec(s);
  if (dt) {
    return new Date(
      Number(dt[1]),
      Number(dt[2]) - 1,
      Number(dt[3]),
      Number(dt[4]),
      Number(dt[5]),
      Number(dt[6] ?? 0),
      0,
    );
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 规划本轮该挂的提醒：未完成待办的 due 提醒（不限桶）+ 晚间日记提醒（今天还没写日记时）。 */
export function planReminders(args: { todos: Todo[]; hasLogToday: boolean; now: Date }): ReminderSpec[] {
  const nowMs = args.now.getTime();
  const today = localDate(args.now);
  const out: ReminderSpec[] = [];
  for (const t of args.todos) {
    if (t.status !== "open" || !t.due) continue;
    const at = dueReminderTime(t.due);
    if (at && at.getTime() > nowMs) {
      out.push({ id: reminderIdForTodo(t.id), at, title: "该办了", body: t.title });
      continue;
    }
    // 已经过了截止：当天 9 点前再催一次，让逾期项不会静默消失。
    if (!isOverdue(t.due, today)) continue;
    const morning = new Date(args.now);
    morning.setHours(DUE_REMINDER_HOUR, 0, 0, 0);
    if (morning.getTime() <= nowMs) continue;
    out.push({ id: reminderIdForTodo(t.id), at: morning, title: "已逾期", body: t.title });
  }
  if (!args.hasLogToday) {
    const at = new Date(args.now);
    at.setHours(DIARY_REMINDER_HOUR, 0, 0, 0);
    if (at.getTime() > nowMs) {
      out.push({ id: DIARY_REMINDER_ID, at, title: "今天还没写日记", body: "和秘书聊聊今天吧" });
    }
  }
  return out;
}

/** 重排策略简单粗暴：先全清；有东西要挂才懒请求权限；然后全量挂上。 */
export async function rescheduleReminders(
  notifier: Notifier,
  args: { todos: Todo[]; hasLogToday: boolean; now: Date },
): Promise<void> {
  const specs = planReminders(args);
  await notifier.cancelAll();
  if (specs.length === 0) return;
  if (!(await notifier.requestPermission())) return;
  await notifier.schedule(specs);
}
