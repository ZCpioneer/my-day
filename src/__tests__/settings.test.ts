import { describe, it, expect } from "vitest";
import {
  loadSettings,
  saveSettings,
  effectiveApiKey,
  loadCollapsedGroups,
  saveCollapsedGroups,
} from "@/storage/settings";
import { DEFAULT_MODEL } from "@/types";

const mem = new Map<string, string>();
const prefs = {
  async get(k: string) {
    return mem.get(k) ?? null;
  },
  async set(k: string, v: string) {
    mem.set(k, v);
  },
};

describe("settings", () => {
  it("defaults model and debug overlay", async () => {
    mem.clear();
    const s = await loadSettings(prefs);
    expect(s.model).toBe(DEFAULT_MODEL);
    expect(s.debugOverlay).toBe(false);
    expect(s.apiKey).toBe("");
    expect(s.daySplitHour).toBe(12);
  });

  it("roundtrips", async () => {
    mem.clear();
    await saveSettings(
      { apiKey: "sk-user", model: "deepseek-v4-pro", debugOverlay: false, daySplitHour: 18 },
      prefs,
    );
    const s = await loadSettings(prefs);
    expect(s.apiKey).toBe("sk-user");
    expect(s.model).toBe("deepseek-v4-pro");
    expect(s.debugOverlay).toBe(false);
    expect(s.daySplitHour).toBe(18);
  });
});

describe("effectiveApiKey", () => {
  it("uses settings then default", () => {
    expect(
      effectiveApiKey(
        { apiKey: "", model: DEFAULT_MODEL, debugOverlay: true, daySplitHour: 12 },
        "sk-debug",
      ),
    ).toBe("sk-debug");
  });
});

describe("collapsedGroups", () => {
  it("roundtrip；空串 key（未分组区）也能存", async () => {
    mem.clear();
    expect(await loadCollapsedGroups(prefs)).toEqual([]);
    await saveCollapsedGroups(["p1", ""], prefs);
    expect(await loadCollapsedGroups(prefs)).toEqual(["p1", ""]);
  });

  it("损坏内容回退空数组", async () => {
    mem.clear();
    mem.set("zhaomu.collapsed-groups", "{oops");
    expect(await loadCollapsedGroups(prefs)).toEqual([]);
    mem.set("zhaomu.collapsed-groups", "[1,2]");
    expect(await loadCollapsedGroups(prefs)).toEqual([]);
  });
});
