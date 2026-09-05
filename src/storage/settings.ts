import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { DEFAULT_MODEL, type Settings } from "../types";
import { resolveApiKey } from "../keys";
import { DEFAULT_DEBUG_KEY } from "../debug/default-key";

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
  if (!raw) return { apiKey: "", model: DEFAULT_MODEL, debugOverlay: false };
  const parsed = JSON.parse(raw) as Partial<Settings>;
  return {
    apiKey: parsed.apiKey ?? "",
    model: parsed.model || DEFAULT_MODEL,
    debugOverlay: parsed.debugOverlay ?? false,
  };
}

export async function saveSettings(s: Settings, prefs: Prefs = defaultPrefs()): Promise<void> {
  await prefs.set(KEY, JSON.stringify(s));
}

export function effectiveApiKey(s: Settings, fallback: string = DEFAULT_DEBUG_KEY): string | null {
  return resolveApiKey(s.apiKey, fallback);
}
