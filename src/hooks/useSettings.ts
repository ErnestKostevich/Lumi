import { useCallback, useState } from "react";
import type { PersonalityMode } from "../lib/personality";
import type { Provider } from "../lib/llm";

/**
 * Lightweight settings store backed by localStorage.
 * We'll migrate to Tauri's secure store (stronghold) for API keys once Pro
 * tier ships — localStorage is fine for indie MVP.
 */

export interface Settings {
  /** Which LLM provider currently active. */
  provider: Provider;
  /** Per-provider API keys (only the active one is used at any time). */
  openRouterKey: string;
  openAIKey: string;
  anthropicKey: string;
  mistralKey: string;
  /** Model id valid for the active provider. */
  model: string;
  userName: string;
  userGoals: string;
  personality: PersonalityMode;
  pomodoroIntroShown: boolean;
  /** Show all OS voices (including male) in the voice picker. Default false = female-only. */
  showAllVoices: boolean;
  /** When true, hide Lumi when another app is fullscreen (game/video). */
  hideOnFullscreen: boolean;
  /** ElevenLabs Pro voice. Empty = use OS Web Speech voices. */
  elevenLabsKey: string;
  elevenLabsVoiceId: string;
  /** License key from the Pro purchase flow (NOWPayments → webhook → email). */
  licenseKey: string;
  /** First-run onboarding completed flag. */
  onboardingShown: boolean;
  /** Cached result of server-side license verification (see config.verifyLicenseRemote). */
  licenseValid: boolean;
  /** Verified plan ("pro" | "dlc") or "" if none. */
  licensePlan: string;
  /** Epoch ms of last successful verification — used for 24h cache + offline grace. */
  licenseCheckedAt: number;
}

const DEFAULTS: Settings = {
  provider: "openrouter",
  openRouterKey: "",
  openAIKey: "",
  anthropicKey: "",
  mistralKey: "",
  // Default to a FREE OpenRouter model so a first-time key costs the user $0.
  model: "google/gemini-2.0-flash-exp:free",
  userName: "",
  userGoals: "",
  personality: "friendly",
  pomodoroIntroShown: false,
  showAllVoices: false,
  hideOnFullscreen: true,
  elevenLabsKey: "",
  elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
  licenseKey: "",
  onboardingShown: false,
  licenseValid: false,
  licensePlan: "",
  licenseCheckedAt: 0,
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

/** Active API key for the currently selected provider. */
export function activeKey(s: Settings): string {
  switch (s.provider) {
    case "mistral": return s.mistralKey;
    case "openai": return s.openAIKey;
    case "anthropic": return s.anthropicKey;
    case "openrouter":
    default: return s.openRouterKey;
  }
}
