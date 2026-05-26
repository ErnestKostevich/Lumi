import { useCallback, useState } from "react";

/**
 * Lightweight settings store backed by localStorage.
 * We'll migrate to Tauri's secure store (stronghold) for the API key once Pro
 * tier ships — localStorage is fine for indie MVP.
 */

import type { PersonalityMode } from "../lib/personality";

export interface Settings {
  openRouterKey: string;
  model: string;
  userName: string;
  userGoals: string;
  personality: PersonalityMode;
  /** Set true after the user dismisses the Pomodoro intro — don't show it again. */
  pomodoroIntroShown: boolean;
  /** License key from the Pro purchase flow (NOWPayments → webhook → email). */
  licenseKey: string;
}

const DEFAULTS: Settings = {
  openRouterKey: "",
  model: "anthropic/claude-3.5-sonnet",
  userName: "",
  userGoals: "",
  personality: "friendly",
  pomodoroIntroShown: false,
  licenseKey: "",
};

const STORAGE_KEY = "anime-buddy:settings:v1";

function load(): Settings {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setState] = useState<Settings>(() => load());

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* quota or disabled — ignore */
      }
      return next;
    });
  }, []);

  return { settings, setSettings };
}
