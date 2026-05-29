import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PROVIDERS, pingProvider, providerShortName, type Provider } from "../lib/llm";
import type { Settings } from "../hooks/useSettings";
import { IconClose, IconEye, IconEyeOff } from "./icons/Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";

/**
 * First-run welcome. The job here is ACTIVATION: make it obvious Lumi already
 * works with zero setup, then turn the API-key step from a wall into a friendly
 * 60-second task pointing at a FREE key. The user can skip and still enjoy the
 * character + Pomodoro + OS voice immediately.
 */
export function OnboardingModal({ open, onClose, settings, onChange }: Props) {
  const [revealKey, setRevealKey] = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState("");

  const providerCfg = PROVIDERS[settings.provider];
  const currentKey = (() => {
    switch (settings.provider) {
      case "mistral": return settings.mistralKey;
      case "openai": return settings.openAIKey;
      case "anthropic": return settings.anthropicKey;
      default: return settings.openRouterKey;
    }
  })();

  const setProviderKey = (value: string) => {
    setTestState("idle");
    switch (settings.provider) {
      case "mistral": onChange({ mistralKey: value }); break;
      case "openai": onChange({ openAIKey: value }); break;
      case "anthropic": onChange({ anthropicKey: value }); break;
      default: onChange({ openRouterKey: value }); break;
    }
  };

  const switchProvider = (p: Provider) => {
    setTestState("idle");
    onChange({ provider: p, model: PROVIDERS[p].defaultModel });
  };

  const openKeyPage = async () => {
    try {
      await openUrl(providerCfg.keyUrl);
    } catch {
      try { window.open(providerCfg.keyUrl, "_blank", "noopener,noreferrer"); } catch { /* noop */ }
    }
  };

  const runTest = async () => {
    if (!currentKey.trim()) return;
    setTestState("testing");
    setTestMsg("");
    const res = await pingProvider({
      provider: settings.provider,
      apiKey: currentKey,
      model: settings.model,
    });
    if (res.ok) {
      setTestState("ok");
      setTestMsg("Works! 🎉");
    } else {
      setTestState("fail");
      setTestMsg(res.reason || "Couldn't reach the model");
    }
  };

  const finish = () => {
    onChange({ onboardingShown: true });
    onClose();
  };

  return (
    <div className={`panel onb-panel ${open ? "open" : ""}`}>
      <div className="panel-header">
        <span className="panel-title">Welcome to Lumi 🌸</span>
        <button className="icon-btn" onClick={finish} title="Skip" aria-label="Skip">
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className="onb-body">
        {/* Step 1 — instant value, no setup needed */}
        <div className="onb-hero">
          <div className="onb-hero-title">I'm already here ✨</div>
          <p className="onb-hero-text">
            Your Pomodoro timer, my voice, and clicking me all work <strong>right now</strong> —
            no account, no setup. Try the 🍅 button when you close this!
          </p>
        </div>

        {/* Step 2 — give her a brain (free key) */}
        <div className="onb-card">
          <div className="onb-card-title">💬 Want to chat with me?</div>
          <p className="onb-card-sub">
            I need an AI brain. Grab a <strong>free</strong> key — takes ~60s, no credit card.
          </p>

          <label className="settings-row">
            <span className="settings-label">AI provider</span>
            <select
              className="settings-input"
              value={settings.provider}
              onChange={(e) => switchProvider(e.target.value as Provider)}
            >
              {Object.values(PROVIDERS).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>

          <button type="button" className="onb-getkey" onClick={openKeyPage}>
            Get a free {providerShortName(settings.provider)} key →
          </button>

          <label className="settings-row">
            <span className="settings-label">{providerShortName(settings.provider)} API key</span>
            <div className="settings-key-row">
              <input
                className="settings-input"
                type={revealKey ? "text" : "password"}
                value={currentKey}
                onChange={(e) => setProviderKey(e.target.value)}
                placeholder={providerCfg.keyHint}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setRevealKey((v) => !v)}
                title={revealKey ? "Hide" : "Show"}
                aria-label="Toggle key visibility"
              >
                {revealKey ? <IconEyeOff width={14} height={14} /> : <IconEye width={14} height={14} />}
              </button>
            </div>
          </label>

          <div className="onb-test-row">
            <button
              type="button"
              className="onb-test-btn"
              onClick={runTest}
              disabled={!currentKey.trim() || testState === "testing"}
            >
              {testState === "testing" ? "Testing…" : "Test my key"}
            </button>
            {testState === "ok" ? <span className="onb-test ok">✓ {testMsg}</span> : null}
            {testState === "fail" ? <span className="onb-test fail">✗ {testMsg}</span> : null}
          </div>
          <span className="settings-hint">
            Default model is <strong>free</strong> — you can pick a paid one later in Settings.
          </span>
        </div>

        {/* Step 3 — personalise */}
        <label className="settings-row">
          <span className="settings-label">What should I call you? (optional)</span>
          <input
            className="settings-input"
            value={settings.userName}
            onChange={(e) => onChange({ userName: e.target.value })}
            placeholder="Your name"
          />
        </label>

        <button className="onb-cta" onClick={finish}>
          {currentKey.trim() ? "Let's go! →" : "Skip for now — I'll still keep you company 🌸"}
        </button>
      </div>
    </div>
  );
}
