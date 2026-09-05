import { describe, it, expect } from "vitest";
import { resolveApiKey, maskKey } from "@/keys";

describe("resolveApiKey", () => {
  it("prefers the settings key", () => {
    expect(resolveApiKey("sk-user", "sk-debug")).toBe("sk-user");
  });
  it("falls back to default", () => {
    expect(resolveApiKey("  ", "sk-debug")).toBe("sk-debug");
  });
  it("returns null when both empty", () => {
    expect(resolveApiKey("", "")).toBe(null);
  });
});

describe("maskKey", () => {
  it("keeps 4 prefix chars", () => {
    expect(maskKey("sk-abcdefghijk")).toBe("sk-a****");
  });
  it("masks short keys fully", () => {
    expect(maskKey("ab")).toBe("****");
  });
});
