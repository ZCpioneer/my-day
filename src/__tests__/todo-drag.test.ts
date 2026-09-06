import { describe, it, expect } from "vitest";
import {
  EDGE_PX,
  HOLD_MS,
  HOLD_SLOP,
  edgeScrollDelta,
  insertIndex,
  movementCancelsHold,
  pickDragBucket,
} from "@/todo-drag";

const zones = {
  today: { top: 0, bottom: 120 },
  later: { top: 120, bottom: 300 },
};

describe("hold thresholds", () => {
  it("uses 450ms and 8px", () => {
    expect(HOLD_MS).toBe(450);
    expect(HOLD_SLOP).toBe(8);
    expect(EDGE_PX).toBe(36);
  });

  it("cancels hold once movement reaches the slop", () => {
    expect(movementCancelsHold(0, 0)).toBe(false);
    expect(movementCancelsHold(7, 7)).toBe(false);
    expect(movementCancelsHold(8, 0)).toBe(true);
    expect(movementCancelsHold(0, 8)).toBe(true);
  });
});

describe("pickDragBucket", () => {
  it("maps y onto today, later, or neither", () => {
    expect(pickDragBucket(10, zones)).toBe("today");
    expect(pickDragBucket(119, zones)).toBe("today");
    expect(pickDragBucket(120, zones)).toBe("later");
    expect(pickDragBucket(250, zones)).toBe("later");
    expect(pickDragBucket(300, zones)).toBe(null);
    expect(pickDragBucket(-4, zones)).toBe(null);
  });
});

describe("insertIndex", () => {
  it("counts rows whose midpoint is above the finger", () => {
    expect(insertIndex(50, [])).toBe(0);
    expect(insertIndex(10, [30, 90, 150])).toBe(0);
    expect(insertIndex(60, [30, 90, 150])).toBe(1);
    expect(insertIndex(160, [30, 90, 150])).toBe(3);
    // 恰好在中点上不算越过
    expect(insertIndex(90, [30, 90, 150])).toBe(1);
  });
});

describe("edgeScrollDelta", () => {
  it("scrolls when the finger is in the 36px edge", () => {
    const view = { top: 100, bottom: 500 };
    expect(edgeScrollDelta(200, view)).toBe(0);
    expect(edgeScrollDelta(120, view)).toBeLessThan(0);
    expect(edgeScrollDelta(480, view)).toBeGreaterThan(0);
  });
});
