import { describe, it, expect } from "vitest";
import { localDate, shiftLocalDate } from "@/dates";

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
