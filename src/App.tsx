import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Character } from "./components/Character";
import { SpeechBubble } from "./components/SpeechBubble";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsModal } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { PomodoroBar } from "./components/PomodoroBar";
import { PomodoroInfoModal } from "./components/PomodoroInfoModal";
import { ParticleField } from "./components/ParticleField";
import { AuraGlow } from "./components/AuraGlow";
import { CharacterScene } from "./components/CharacterScene";
import { LogoMark } from "./components/Logo";
import {
  IconChat,
  IconClose,
  IconMinimize,
  IconSettings,
  IconTomato,
} from "./components/icons/Icons";
import { useSettings, activeKey } from "./hooks/useSettings";
import { useChat } from "./hooks/useChat";
import { usePomodoro, type PomodoroPhase } from "./hooks/usePomodoro";
import { useTTS } from "./hooks/useTTS";
import { useActiveWindow } from "./hooks/useActiveWindow";
import { useSnapToEdge } from "./hooks/useSnapToEdge";
import { useHideOnFullscreen } from "./hooks/useHideOnFullscreen";
import { loadRecentMessages, appendMessage, clearMessages } from "./lib/db";
import { verifyLicenseRemote } from "./lib/config";
import "./App.css";

function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [lastUtterance, setLastUtterance] = useState<{ text: string; streaming: boolean }>({
    text: "",
    streaming: false,
  });
  const [mouthAmp, setMouthAmp] = useState(0);
  const [reactionTick, setReactionTick] = useState(0);

  const { settings, setSettings } = useSettings();

  // First launch → onboarding (which also covers the Pomodoro pitch). The
  // standalone Pomodoro explainer stays reachable from the ? button.
  useEffect(() => {
    if (!settings.onboardingShown) {
      const t = window.setTimeout(() => setOnboardingOpen(true), 900);
      return () => window.clearTimeout(t);
    }
  }, [settings.onboardingShown]);

  // ---- Real Pro license verification (server-side HMAC check) ----
  // Gates Pro on a verified result, not on "any non-empty string". Caches for
  // 24h; on network failure we keep a previously-valid, unexpired result
  // (offline grace).
  useEffect(() => {
    const key = settings.licenseKey.trim();
    if (!key) {
      if (settings.licenseValid) setSettings({ licenseValid: false, licensePlan: "" });
      return;
    }
    const fresh = Date.now() - settings.licenseCheckedAt < 24 * 60 * 60 * 1000;
    if (settings.licenseValid && fresh) return; // cached + recent — skip
    let cancelled = false;
    void verifyLicenseRemote(key).then((res) => {
      if (cancelled) return;
      if (res.valid) {
        setSettings({
          licenseValid: true,
          licensePlan: res.plan ?? "pro",
          licenseCheckedAt: Date.now(),
        });
      } else if (!settings.licenseValid) {
        // Only downgrade if we weren't already valid (offline grace).
        setSettings({ licenseValid: false, licensePlan: "" });
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.licenseKey]);

  const tts = useTTS({
    onAmplitude: setMouthAmp,
    enabled: true,
    showAllVoices: settings.showAllVoices,
    elevenLabsKey: settings.elevenLabsKey,
    elevenLabsVoiceId: settings.elevenLabsVoiceId,
    // Gate Pro voice on the VERIFIED license, not the raw key string.
    licenseKey: settings.licenseValid ? settings.licenseKey : "",
  });
  const activeWin = useActiveWindow(8000);
  const distractionNudgedRef = useRef<number>(0);
  useSnapToEdge();
  useHideOnFullscreen(settings.hideOnFullscreen);

  const handlePhaseChange = useCallback(
    (phase: PomodoroPhase, cyclesDone: number) => {
      const msg = nudgeForPhase(phase, cyclesDone);
      if (msg) {
        setLastUtterance({ text: msg, streaming: false });
        tts.speak(msg);
      }
    },
    [tts],
  );
  const pomodoro = usePomodoro(handlePhaseChange);

  const buildContext = useCallback(
    () => ({
      userName: settings.userName,
      userGoals: settings.userGoals,
      pomodoroPhase: pomodoro.phase,
      pomodoroRemaining: pomodoro.remaining,
      characterName: "Lumi",
      mode: settings.personality,
      activeApp: activeWin.window?.app_name,
      activeWindowTitle: activeWin.window?.title,
      appCategory: activeWin.category,
      appStreakMinutes: Math.floor(activeWin.categoryStreakMs / 60_000),
    }),
    [
      settings.userName,
      settings.userGoals,
      pomodoro.phase,
      pomodoro.remaining,
      settings.personality,
      activeWin.window,
      activeWin.category,
      activeWin.categoryStreakMs,
    ],
  );

  const onAssistantTurn = useCallback(
    (text: string) => {
      setLastUtterance({ text, streaming: false });
      tts.speak(text);
    },
    [tts],
  );

  const chat = useChat({
    provider: settings.provider,
    apiKey: activeKey(settings),
    model: settings.model,
    buildContext,
    onAssistantTurn,
    onNeedsKey: () => {
      setChatOpen(false);
      setOnboardingOpen(true);
    },
  });

  // ---- SQLite chat history: load on mount + append on each finalized turn ----
  const persistedUpTo = useRef(0);
  useEffect(() => {
    loadRecentMessages(40).then((past) => {
      if (past.length) {
        chat.setTurns(past);
        persistedUpTo.current = past.length;
      }
    }).catch(() => {/* db unavailable in browser preview */});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    for (let i = persistedUpTo.current; i < chat.turns.length; i++) {
      const t = chat.turns[i];
      if (t.streaming) return; // still streaming — wait until next render
      if (!t.content.trim()) continue;
      void appendMessage(t.role, t.content);
      persistedUpTo.current = i + 1;
    }
  }, [chat.turns]);

  const handleClearChat = useCallback(() => {
    chat.clear();
    persistedUpTo.current = 0;
    void clearMessages();
  }, [chat]);

  const liveBubble = useMemo(() => {
    const last = chat.turns[chat.turns.length - 1];
    if (last?.role === "assistant" && last.streaming) {
      return { text: last.content || "…", streaming: true };
    }
    return lastUtterance;
  }, [chat.turns, lastUtterance]);

  useEffect(() => {
    if (settingsOpen) tts.stop();
  }, [settingsOpen, tts]);

  // Spontaneous nudge: if user has been on distracting app 5+ min and we
  // haven't nudged in the last 4 min, Lumi calls them out.
  useEffect(() => {
    if (activeWin.category !== "distracting") return;
    if (activeWin.categoryStreakMs < 5 * 60_000) return;
    const now = Date.now();
    if (now - distractionNudgedRef.current < 4 * 60_000) return;
    distractionNudgedRef.current = now;
    const nudge = distractionNudge(
      settings.personality,
      activeWin.window?.app_name ?? "that app",
      Math.floor(activeWin.categoryStreakMs / 60_000),
    );
    setLastUtterance({ text: nudge, streaming: false });
    tts.speak(nudge);
  }, [activeWin.category, activeWin.categoryStreakMs, activeWin.window, settings.personality, tts]);

  const mood: "idle" | "focus" | "break" =
    pomodoro.phase === "working" ? "focus" : pomodoro.phase === "break" ? "break" : "idle";

  const dismissInfo = useCallback(() => {
    setInfoOpen(false);
    setSettings({ pomodoroIntroShown: true });
  }, [setSettings]);

  return (
    <div className={`app mood-${mood}`}>
      <div className="window-frame" aria-hidden />
      <div className="bg-gradient" aria-hidden />
      <ParticleField count={12} />

      <div className="topbar" data-tauri-drag-region>
        <div className="topbar-brand" data-tauri-drag-region>
          <LogoMark className="brand-logo" width={18} height={18} />
          <span className="brand-name">Lumi</span>
          <span className="brand-sub">· Anime Study Buddy</span>
        </div>
        <div className="topbar-actions">
          <button
            className="window-btn"
            onClick={() => getCurrentWindow().minimize()}
            title="Minimize"
            aria-label="Minimize"
          >
            <IconMinimize width={12} height={12} />
          </button>
          <button
            className="window-btn window-btn-close"
            onClick={() => getCurrentWindow().close()}
            title="Close"
            aria-label="Close"
          >
            <IconClose width={12} height={12} />
          </button>
        </div>
      </div>

      <PomodoroBar
        phase={pomodoro.phase}
        remaining={pomodoro.remaining}
        cyclesDone={pomodoro.cyclesDone}
        onStart={pomodoro.start}
        onStop={pomodoro.stop}
        onSkip={pomodoro.skip}
      />

      <div className="bubble-layer">
        <SpeechBubble text={liveBubble.text} streaming={liveBubble.streaming} />
      </div>

      <div className="stage" data-tauri-drag-region>
        <CharacterScene mood={mood} />
        <div className="character-anchor">
          <AuraGlow mood={mood} />
          <Character
            width={300}
            height={400}
            mouthAmplitude={mouthAmp}
            reactionTrigger={reactionTick}
            mood={mood}
            onClick={() => {
              setReactionTick((n) => n + 1);
              const lines = clickReactionsFor(settings.personality);
              const pick = lines[Math.floor(Math.random() * lines.length)];
              setLastUtterance({ text: pick, streaming: false });
              tts.speak(pick);
            }}
          />
        </div>
      </div>

      <div className="dock">
        <button
          className="dock-btn"
          onClick={() => setChatOpen(true)}
          title="Chat"
          aria-label="Chat"
        >
          <IconChat width={18} height={18} />
        </button>
        <button
          className={`dock-btn dock-btn-primary ${pomodoro.phase !== "idle" ? "active" : ""}`}
          onClick={pomodoro.phase === "idle" ? pomodoro.start : pomodoro.stop}
          onContextMenu={(e) => {
            e.preventDefault();
            setInfoOpen(true);
          }}
          title={pomodoro.phase === "idle" ? "Start Pomodoro (right-click for info)" : "Stop Pomodoro"}
          aria-label="Pomodoro"
        >
          <IconTomato width={18} height={18} />
        </button>
        <button
          className="dock-btn"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
        >
          <IconSettings width={18} height={18} />
        </button>
      </div>

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        turns={chat.turns}
        busy={chat.busy}
        onSend={chat.send}
        onClear={handleClearChat}
        onRetry={chat.retry}
        hasKey={!!activeKey(settings)}
        onSetupKey={() => {
          setChatOpen(false);
          setOnboardingOpen(true);
        }}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
        tts={tts}
        onShowPomodoroInfo={() => {
          setSettingsOpen(false);
          setInfoOpen(true);
        }}
      />
      <OnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        settings={settings}
        onChange={setSettings}
      />
      <PomodoroInfoModal
        open={infoOpen}
        onClose={dismissInfo}
        onStart={() => {
          dismissInfo();
          pomodoro.start();
        }}
      />
    </div>
  );
}

function distractionNudge(mode: string, app: string, minutes: number): string {
  const a = app.replace(/\.exe$/i, "");
  switch (mode) {
    case "sassy":
      return [
        `${a} for ${minutes} minutes. Cool, cool. Back to work?`,
        `Oh look, ${a} again. Productive.`,
        `${minutes} minutes on ${a}. The crown is heavy.`,
      ][Math.floor(Math.random() * 3)];
    case "cheerleader":
      return [
        `Hey hey! Quick break's been ${minutes} min — let's go back, you got this! 💪`,
        `${a} time over? Round two is calling! ✨`,
      ][Math.floor(Math.random() * 2)];
    case "formal":
      return `You have been on ${a} for ${minutes} minutes. Would you like to resume work?`;
    default:
      return [
        `Hey — ${a} for ${minutes} min already. Maybe time to refocus? 🌸`,
        `${minutes} minutes of ${a}. Wanna start a Pomodoro?`,
      ][Math.floor(Math.random() * 2)];
  }
}

function clickReactionsFor(mode: string): string[] {
  switch (mode) {
    case "sassy":
      return [
        "Yes, I'm right here. Eyes on the screen.",
        "Don't poke me — poke your todo list.",
        "Cute, but unproductive.",
        "Hehe — caught you slacking again~",
        "Mhm? Distracted already?",
      ];
    case "cheerleader":
      return [
        "Hi hi! Ready to crush it? ✨",
        "You came back! Let's go! 🌸",
        "I see you! Round two? 💪",
        "Yay~ hi friend! ✿",
        "There you are! Let's gooo ⭐",
      ];
    case "formal":
      return [
        "How can I help you focus?",
        "Ready when you are.",
        "Shall we begin a Pomodoro?",
        "Yes? I am here.",
      ];
    default:
      return [
        "Hi! Need anything? 🌸",
        "Hey, you got this ✨",
        "Tap again if you wanna chat!",
        "Ehehe~ that tickles 🌸",
        "Awww, hi there~",
        "Mm? Cheering you on ✿",
        "You poked me~ tehee",
      ];
  }
}

function nudgeForPhase(phase: PomodoroPhase, cyclesDone: number): string | null {
  if (phase === "working") {
    const v = [
      "25 minutes of focus — let's go!",
      "Phones away, eyes on the screen.",
      `Round ${cyclesDone + 1}. You've got this!`,
    ];
    return v[Math.floor(Math.random() * v.length)];
  }
  if (phase === "break") {
    const v = [
      "Time's up! Stretch and breathe.",
      "Nice work — 5 minute break, look away from the screen.",
      "Sip some water.",
    ];
    return v[Math.floor(Math.random() * v.length)];
  }
  return null;
}

export default App;
