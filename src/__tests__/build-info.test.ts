import { describe, it, expect } from "vitest";
import { APP_VERSION, BUILD_ISO, BUILD_LABEL, formatBuildTime } from "@/build-info";

describe("formatBuildTime", () => {
  it("formats an ISO timestamp to local time, precise to the second", () => {
    const iso = new Date(2026, 8, 5, 16, 4, 2).toISOString();
    expect(formatBuildTime(iso)).toBe("2026-09-05 16:04:02");
  });

  it("returns empty for missing or invalid input", () => {
    expect(formatBuildTime("")).toBe("");
    expect(formatBuildTime("not-a-date")).toBe("");
  });
});

describe("BUILD_LABEL", () => {
  it("carries the version and falls back clearly without an injected build stamp", () => {
    // 测试环境没有 vite define 注入，应走回退文案
    expect(BUILD_ISO).toBe("");
    expect(BUILD_LABEL).toContain(`版本 ${APP_VERSION}`);
    expect(BUILD_LABEL).toContain("开发模式");
  });
});
