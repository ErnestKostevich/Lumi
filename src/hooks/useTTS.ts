import { useCallback, useEffect, useRef, useState } from "react";
import { speakEleven } from "../lib/elevenlabs";

/**
 * TTS hook with two backends:
 *   - "web"   → browser SpeechSynthesis (free, OS voices, simulated mouth amplitude)
 *   - "eleven" → ElevenLabs Flash v2.5 streaming (Pro, anime voices, real amplitude via AnalyserNode)
 *
 * The active backend is chosen by the parent based on settings.
 */

interface UseTTSOpts {
  onAmplitude?: (level: number) => void;
  enabled?: boolean;
  showAllVoices?: boolean;
  /** When set + non-empty key, ElevenLabs is used instead of Web Speech. */
  elevenLabsKey?: string;
  elevenLabsVoiceId?: string;
}

interface UseTTSReturn {
  voices: SpeechSynthesisVoice[];
  voiceId: string;
  setVoiceId: (id: string) => void;
  speak: (text: string) => void;
  stop: () => void;
  speaking: boolean;
  supported: boolean;
  backend: "web" | "eleven";
}

const FEMALE_NAME_HINTS = [
  "aria", "jenny", "ava", "ana", "anna", "emma", "michelle", "natasha",
  "samantha", "victoria", "karen", "moira", "tessa", "fiona", "veena",
  "zira", "hazel", "susan", "linda", "heather", "catherine",
  "monica", "paulina", "ines", "sara", "luciana", "joana", "elena", "yuna",
  "kyoko", "haruka", "sayaka", "nanami", "mizuki", "siri (female",
  "google us english", "google uk english female",
];

const MALE_NAME_HINTS = [
  "mark", "david", "george", "alex", "daniel", "fred", "ralph", "tom",
  "james", "brian", "richard", "guy", "ryan", "matthew", "jorge", "diego",
  "carlos", "thomas", "oliver", "william", "ichiro", "otoya", "google us english male",
];

function isLikelyFemale(v: SpeechSynthesisVoice): boolean {
  const n = v.name.toLowerCase();
  if (MALE_NAME_HINTS.some((m) => n.includes(m))) return false;
  if (FEMALE_NAME_HINTS.some((f) => n.includes(f))) return true;
  if (/\bfemale\b/i.test(v.name)) return true;
  if (/\bmale\b/i.test(v.name)) return false;
  return false;
}

const VOICE_PREFERENCE = [
  "aria", "jenny", "ava", "ana", "natasha",
  "zira", "samantha", "hazel", "emma",
];

function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const female = voices.filter(isLikelyFemale);
  const pool = female.length ? female : voices;
  for (const pref of VOICE_PREFERENCE) {
    const m = pool.find((v) => v.name.toLowerCase().includes(pref));
    if (m) return m;
  }
  const en = pool.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (en.length) return en[0];
  return pool[0];
}

function filterFemale(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const female = voices.filter(isLikelyFemale);
  return female.sort((a, b) => {
    const ae = a.lang.toLowerCase().startsWith("en") ? 0 : 1;
    const be = b.lang.toLowerCase().startsWith("en") ? 0 : 1;
    if (ae !== be) return ae - be;
    return a.name.localeCompare(b.name);
  });
}

export function useTTS({
  onAmplitude,
  enabled = true,
  showAllVoices = false,
  elevenLabsKey = "",
  elevenLabsVoiceId = "",
}: UseTTSOpts = {}): UseTTSReturn {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [speaking, setSpeaking] = useState(false);
  const ampIntervalRef = useRef<number | null>(null);
  const elevenAbortRef = useRef<AbortController | null>(null);
  const onAmpRef = useRef(onAmplitude);
  onAmpRef.current = onAmplitude;

  const backend: "web" | "eleven" = elevenLabsKey ? "eleven" : "web";

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      if (showAllVoices) {
        const sorted = [...all].sort((a, b) => {
          const ae = a.lang.toLowerCase().startsWith("en") ? 0 : 1;
          const be = b.lang.toLowerCase().startsWith("en") ? 0 : 1;
          if (ae !== be) return ae - be;
          return a.name.localeCompare(b.name);
        });
        setVoices(sorted);
      } else {
        const female = filterFemale(all);
        setVoices(female.length ? female : all);
      }
      setVoiceId((cur) => {
        if (cur) return cur;
        const best = pickBestVoice(all);
        return best?.voiceURI ?? "";
      });
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [supported, showAllVoices]);

  const stopAmpInterval = useCallback(() => {
    if (ampIntervalRef.current != null) {
      window.clearInterval(ampIntervalRef.current);
      ampIntervalRef.current = null;
    }
    onAmpRef.current?.(0);
  }, []);

  const speak = useCallback(
    (rawText: string) => {
      if (!enabled) return;
      const text = rawText.trim();
      if (!text) return;

      // ---- ElevenLabs Pro path ----
      if (backend === "eleven" && elevenLabsKey) {
        if (elevenAbortRef.current) elevenAbortRef.current.abort();
        const ctrl = new AbortController();
        elevenAbortRef.current = ctrl;
        setSpeaking(true);
        void speakEleven({
          apiKey: elevenLabsKey,
          voiceId: elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM",
          text,
          onAmplitude: (a) => onAmpRef.current?.(a),
          onEnd: () => {
            setSpeaking(false);
            onAmpRef.current?.(0);
          },
          onError: (err) => {
            console.warn("[useTTS] ElevenLabs failed, falling back to Web Speech:", err);
            setSpeaking(false);
            onAmpRef.current?.(0);
            // Fall through to web speech
            webSpeechSpeak(text);
          },
          signal: ctrl.signal,
        });
        return;
      }

      webSpeechSpeak(text);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, backend, elevenLabsKey, elevenLabsVoiceId, voices, voiceId],
  );

  const webSpeechSpeak = useCallback(
    (text: string) => {
      if (!supported) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const v = voices.find((x) => x.voiceURI === voiceId);
        if (v) u.voice = v;
        u.rate = 1.05;
        u.pitch = 1.18;
        u.volume = 0.95;

        u.onstart = () => {
          setSpeaking(true);
          let phase = 0;
          ampIntervalRef.current = window.setInterval(() => {
            phase += 0.42;
            const base = (Math.sin(phase) + 1) / 2;
            const noise = (Math.random() - 0.5) * 0.3;
            const amp = Math.max(0.05, Math.min(1, base * 0.6 + 0.3 + noise));
            onAmpRef.current?.(amp);
          }, 70);
        };
        const finish = () => {
          stopAmpInterval();
          setSpeaking(false);
        };
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
      } catch (err) {
        console.warn("[useTTS] web speech failed:", err);
        stopAmpInterval();
        setSpeaking(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supported, voices, voiceId, stopAmpInterval],
  );

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    if (elevenAbortRef.current) elevenAbortRef.current.abort();
    stopAmpInterval();
    setSpeaking(false);
  }, [supported, stopAmpInterval]);

  useEffect(() => {
    return () => {
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      if (elevenAbortRef.current) elevenAbortRef.current.abort();
      if (ampIntervalRef.current != null) window.clearInterval(ampIntervalRef.current);
    };
  }, []);

  return { voices, voiceId, setVoiceId, speak, stop, speaking, supported, backend };
}
