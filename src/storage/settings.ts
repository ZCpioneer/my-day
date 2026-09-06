import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { DEFAULT_MODEL, type Settings } from "../types";
import { resolveApiKey } from "../keys";
import { DEFAULT_DEBUG_KEY } from "../debug/default-key";
import { clampSplitHour, DEFAULT_SPLIT_HOUR } from "../ritual";

const KEY = "zhaomu.settings";

export interface Prefs {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const localPrefs: Prefs = {
  async get(key) {
    return localStorage.getItem(key);
  },
  async set(key, value) {
    localStorage.setItem(key, value);
  },
};

const capPrefs: Prefs = {
  async get(key) {
    const { value } = await Preferences.get({ key });
    return value;
  },
  async set(key, value) {
    await Preferences.set({ key, value });
  },
};

function defaultPrefs(): Prefs {
  return Capacitor.isNativePlatform() ? capPrefs : localPrefs;
}

export async function loadSettings(prefs: Prefs = defaultPrefs()): Promise<Settings> {
  const raw = await prefs.get(KEY);
  if (!raw) {
    return { apiKey: "", model: DEFAULT_MODEL, debugOverlay: false, daySplitHour: DEFAULT_SPLIT_HOUR };
  }
  const parsed = JSON.parse(raw) as Partial<Settings>;
  return {
    apiKey: parsed.apiKey ?? "",
    model: parsed.model || DEFAULT_MODEL,
    debugOverlay: parsed.debugOverlay ?? false,
    daySplitHour: clampSplitHour(parsed.daySplitHour ?? DEFAULT_SPLIT_HOUR),
  };
}

export async function saveSettings(s: Settings, prefs: Prefs = defaultPrefs()): Promise<void> {
  await prefs.set(KEY, JSON.stringify(s));
}

export function effectiveApiKey(s: Settings, fallback: string = DEFAULT_DEBUG_KEY): string | null {
  return resolveApiKey(s.apiKey, fallback);
}

const COLLAPSED_KEY = "zhaomu.collapsed-groups";

/** 「以后」栏各分区的折叠状态（组 id 列表；未分组区用空串）。 */
export async function loadCollapsedGroups(prefs: Prefs = defaultPrefs()): Promise<string[]> {
  const raw = await prefs.get(COLLAPSED_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveCollapsedGroups(ids: string[], prefs: Prefs = defaultPrefs()): Promise<void> {
  await prefs.set(COLLAPSED_KEY, JSON.stringify(ids));
}
