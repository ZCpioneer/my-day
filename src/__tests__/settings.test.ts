import { describe, it, expect } from "vitest";
import { loadSettings, saveSettings, effectiveApiKey } from "@/storage/settings";
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
    expect(s.debugOverlay).toBe(true);
    expect(s.apiKey).toBe("");
  });

  it("roundtrips", async () => {
    mem.clear();
    await saveSettings({ apiKey: "sk-user", model: "deepseek-v4-pro", debugOverlay: false }, prefs);
    const s = await loadSettings(prefs);
    expect(s.apiKey).toBe("sk-user");
    expect(s.model).toBe("deepseek-v4-pro");
    expect(s.debugOverlay).toBe(false);
  });
});

describe("effectiveApiKey", () => {
  it("uses settings then default", () => {
    expect(effectiveApiKey({ apiKey: "", model: DEFAULT_MODEL, debugOverlay: true }, "sk-debug")).toBe(
      "sk-debug",
    );
  });
});
