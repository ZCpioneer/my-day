import { describe, it, expect } from "vitest";
import { dayLabel, dayNumLabel, localDate, monthLabel, shiftLocalDate, weekDates, weekdayLabel, weekKey } from "@/dates";

describe("localDate", () => {
  it("formats the local calendar day", () => {
    const d = new Date(2026, 8, 5, 23, 30, 0);
    expect(localDate(d)).toBe("2026-09-05");
  });
});

describe("shiftLocalDate", () => {
  it("moves by whole local calendar days and crosses months", () => {
    expect(shiftLocalDate("2026-09-05", -1)).toBe("2026-09-04");
    expect(shiftLocalDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftLocalDate("2026-09-05", 0)).toBe("2026-09-05");
  });
});

describe("weekKey", () => {
  it("周一到周日同一周，下一周一进新周", () => {
    // 2026-09-07 是周一，2026-09-13 是周日，同属 2026-W37。
    expect(weekKey(new Date(2026, 8, 7))).toBe("2026-W37");
    expect(weekKey(new Date(2026, 8, 13, 23, 59))).toBe("2026-W37");
    expect(weekKey(new Date(2026, 8, 14))).toBe("2026-W38");
  });

  it("跨年周：2025-12-29（周一）起算 2026-W01", () => {
    expect(weekKey(new Date(2025, 11, 29))).toBe("2026-W01");
    expect(weekKey(new Date(2026, 0, 1))).toBe("2026-W01");
    expect(weekKey(new Date(2026, 0, 4))).toBe("2026-W01");
    expect(weekKey(new Date(2025, 11, 28))).toBe("2025-W52");
  });

  it("跨年周：2027-01-01 仍属 2026-W53", () => {
    expect(weekKey(new Date(2026, 11, 28))).toBe("2026-W53");
    expect(weekKey(new Date(2027, 0, 3))).toBe("2026-W53");
    expect(weekKey(new Date(2027, 0, 4))).toBe("2027-W01");
  });

  it("周数补零到两位", () => {
    expect(weekKey(new Date(2026, 0, 5))).toBe("2026-W02");
  });
});

describe("weekDates", () => {
  it("周日取的也是同一周：周一起周日止", () => {
    expect(weekDates(new Date(2026, 8, 13))).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("周一取的本周从当天开始；跨年周横跨两个月", () => {
    expect(weekDates(new Date(2026, 8, 7))[0]).toBe("2026-09-07");
    const days = weekDates(new Date(2025, 11, 31));
    expect(days[0]).toBe("2025-12-29");
    expect(days[6]).toBe("2026-01-04");
  });
});

describe("weekdayLabel", () => {
  it("按本地日历日给中文星期，周日是周日", () => {
    // 2026-09-07 是周一（与 weekKey 用例同一锚点）
    expect(weekdayLabel("2026-09-07")).toBe("周一");
    expect(weekdayLabel("2026-09-13")).toBe("周日");
    expect(weekdayLabel("2026-09-14")).toBe("周一");
  });
});

describe("dayLabel", () => {
  it("写成「9月7日」，月份和日去掉前导零", () => {
    expect(dayLabel("2026-09-07")).toBe("9月7日");
    expect(dayLabel("2026-12-13")).toBe("12月13日");
  });
});

describe("dayNumLabel", () => {
  it("去掉月、去掉前导零", () => {
    expect(dayNumLabel("2026-09-05")).toBe("5日");
    expect(dayNumLabel("2026-09-13")).toBe("13日");
  });
});

describe("monthLabel", () => {
  it("同年只写月，跨年带年", () => {
    expect(monthLabel("2026-09-05", "2026-09-14")).toBe("9月");
    expect(monthLabel("2025-12-01", "2026-09-14")).toBe("2025年12月");
  });
});
