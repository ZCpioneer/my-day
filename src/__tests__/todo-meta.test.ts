import { describe, expect, it } from "vitest";
import { dueLabel, estimateLabel, isOverdue, todoMeta } from "@/todo-meta";

describe("dueLabel", () => {
  const today = "2026-09-06";
  it("逾期/今天/明天/更远", () => {
    expect(dueLabel("2026-09-05", today)).toBe("已逾期");
    expect(dueLabel("2026-09-06", today)).toBe("今天");
    expect(dueLabel("2026-09-06T15:00:00", today)).toBe("今天");
    expect(dueLabel("2026-09-07", today)).toBe("明天");
    expect(dueLabel("2026-10-01", today)).toBe("10月1日");
  });
  it("非法格式原样返回", () => {
    expect(dueLabel("下周三", today)).toBe("下周三");
  });
});

describe("estimateLabel", () => {
  it("分钟与小时的换算", () => {
    expect(estimateLabel(30)).toBe("约30分钟");
    expect(estimateLabel(60)).toBe("约1小时");
    expect(estimateLabel(90)).toBe("约1.5小时");
    expect(estimateLabel(undefined)).toBe("");
    expect(estimateLabel(0)).toBe("");
  });
});

describe("isOverdue", () => {
  it("早于今天的 ISO 日期算逾期，非法格式不算", () => {
    expect(isOverdue("2026-09-05", "2026-09-06")).toBe(true);
    expect(isOverdue("2026-09-06", "2026-09-06")).toBe(false);
    expect(isOverdue("下周三", "2026-09-06")).toBe(false);
    expect(isOverdue(undefined, "2026-09-06")).toBe(false);
  });
});

describe("todoMeta", () => {
  it("拼接 急/截止/项目", () => {
    expect(todoMeta({ priority: "high", due: "2026-09-07", project: "接私活" }, "2026-09-06")).toBe("急 · 明天 · 接私活");
    expect(todoMeta({}, "2026-09-06")).toBe("");
    expect(todoMeta({ priority: "normal" }, "2026-09-06")).toBe("");
  });

  it("带上预估耗时", () => {
    expect(todoMeta({ estimate: 90, project: "搬家" }, "2026-09-06")).toBe("约1.5小时 · 搬家");
  });
});
