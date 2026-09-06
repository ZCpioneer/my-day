import { shiftLocalDate } from "./dates";

/** 截止时间的人话标签：已逾期 / 今天 / 明天 / M月D日；非法格式原样返回。 */
export function dueLabel(due: string, today: string): string {
  const day = due.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return due;
  if (day < today) return "已逾期";
  if (day === today) return "今天";
  if (day === shiftLocalDate(today, 1)) return "明天";
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
}

/** 确认框与待办行共用的徽标行：急 · 截止 · 项目。 */
export function todoMeta(
  input: { priority?: "high" | "normal"; due?: string; project?: string },
  today: string,
): string {
  const parts: string[] = [];
  if (input.priority === "high") parts.push("急");
  if (input.due) parts.push(dueLabel(input.due, today));
  if (input.project) parts.push(input.project);
  return parts.join(" · ");
}
