import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Character } from "./components/Character";
import { SpeechBubble } from "./components/SpeechBubble";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsModal } from "./components/SettingsModal";
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
import { useSettings } from "./hooks/useSettings";
import { useChat } from "./hooks/useChat";
import { usePomodoro, type PomodoroPhase } from "./hooks/usePomodoro";
import { useTTS } from "./hooks/useTTS";
import "./App.css";

function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [lastUtterance, setLastUtterance] = useState<{ text: string; streaming: boolean }>({
    text: "",
    streaming: false,
  });
  const [mouthAmp, setMouthAmp] = useState(0);
  const [reactionTick, setReactionTick] = useState(0);

  const { settings, setSettings } = useSettings();

  // Show the Pomodoro explainer once on first launch.
  useEffect(() => {
    if (!settings.pomodoroIntroShown) {
      const t = window.setTimeout(() => setInfoOpen(true), 1200);
      return () => window.clearTimeout(t);
    }
  }, [settings.pomodoroIntroShown]);

  const tts = useTTS({ onAmplitude: setMouthAmp, enabled: true });

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
    }),
    [settings.userName, settings.userGoals, pomodoro.phase, pomodoro.remaining, settings.personality],
  );

  const onAssistantTurn = useCallback(
    (text: string) => {
      setLastUtterance({ text, streaming: false });
      tts.speak(text);
    },
    [tts],
  );

  const chat = useChat({
    apiKey: settings.openRouterKey,
    model: settings.model,
    buildContext,
    onAssistantTurn,
  });

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
            size={300}
            mouthAmplitude={mouthAmp}
            reactionTrigger={reactionTick}
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
        onClear={chat.clear}
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

function clickReactionsFor(mode: string): string[] {
  switch (mode) {
    case "sassy":
      return [
        "Yes, I'm right here. Eyes on the screen.",
        "Don't poke me — poke your todo list.",
        "Cute, but unproductive.",
      ];
    case "cheerleader":
      return [
        "Hi hi! Ready to crush it? ✨",
        "You came back! Let's go! 🌸",
        "I see you! Round two? 💪",
      ];
    case "formal":
      return [
        "How can I help you focus?",
        "Ready when you are.",
        "Shall we begin a Pomodoro?",
      ];
    default:
      return [
        "Hi! Need anything? 🌸",
        "Hey, you got this ✨",
        "Tap again if you wanna chat!",
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
