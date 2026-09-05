import { describe, it, expect, beforeEach } from "vitest";
import { debugLog } from "@/debug/log";

describe("debugLog", () => {
  beforeEach(() => debugLog.clear());

  it("stores events with time", () => {
    debugLog.push({ event: "http_fail", detail: "timeout", status: 0 });
    expect(debugLog.entries).toHaveLength(1);
    expect(debugLog.entries[0].event).toBe("http_fail");
    expect(debugLog.entries[0].status).toBe(0);
    expect(debugLog.entries[0].time.length).toBeGreaterThan(0);
  });

  it("truncates long detail", () => {
    debugLog.push({ event: "http_ok", detail: "x".repeat(800) });
    expect(debugLog.entries[0].detail.length).toBe(500);
  });

  it("toText is copyable", () => {
    debugLog.push({ event: "tool_call", detail: "propose_todos", tool: "propose_todos" });
    expect(debugLog.toText()).toContain("propose_todos");
  });
});
