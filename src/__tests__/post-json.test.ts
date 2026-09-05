import { describe, it, expect } from "vitest";
import { activePostJson, browserPostJson } from "@/api/post-json";

describe("activePostJson", () => {
  it("uses browserPostJson off native", () => {
    expect(activePostJson()).toBe(browserPostJson);
  });
});
