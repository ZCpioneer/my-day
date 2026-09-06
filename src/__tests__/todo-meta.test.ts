import { describe, expect, it } from "vitest";
import { dueLabel, todoMeta } from "@/todo-meta";

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

describe("todoMeta", () => {
  it("拼接 急/截止/项目/标签", () => {
    expect(todoMeta({ priority: "high", due: "2026-09-07", project: "接私活" }, "2026-09-06")).toBe("急 · 明天 · 接私活");
    expect(todoMeta({ tag: "偏好" }, "2026-09-06")).toBe("偏好");
    expect(todoMeta({}, "2026-09-06")).toBe("");
    expect(todoMeta({ priority: "normal" }, "2026-09-06")).toBe("");
  });
});
