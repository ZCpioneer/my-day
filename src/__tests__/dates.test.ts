import { describe, it, expect } from "vitest";
import { localDate } from "@/dates";

describe("localDate", () => {
  it("formats the local calendar day", () => {
    const d = new Date(2026, 8, 5, 23, 30, 0);
    expect(localDate(d)).toBe("2026-09-05");
  });
});
