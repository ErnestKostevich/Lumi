import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RECOMMENDED_MODELS } from "../lib/llm";
import { PERSONALITY_MODES, type PersonalityMode } from "../lib/personality";
import { checkoutUrl } from "../lib/config";
import type { Settings } from "../hooks/useSettings";
import { IconClose, IconEye, IconEyeOff } from "./icons/Icons";

interface TTSHandle {
  voices: SpeechSynthesisVoice[];
  voiceId: string;
  setVoiceId: (id: string) => void;
  speak: (text: string) => void;
  supported: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  tts?: TTSHandle;
  onShowPomodoroInfo?: () => void;
}

export function SettingsModal({ open, onClose, settings, onChange, tts, onShowPomodoroInfo }: Props) {
  const [revealKey, setRevealKey] = useState(false);

  const handleUpgrade = async () => {
    const url = checkoutUrl("pro");
    try {
      await openUrl(url);
    } catch {
      // Fallback: best effort if Tauri shell plugin not loaded.
      window.open(url, "_blank");
    }
  };

  return (
    <div className={`panel settings-panel ${open ? "open" : ""}`}>
      <div className="panel-header">
        <span className="panel-title">Settings</span>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className="settings-body">
        {/* ============ Pro upgrade card ============ */}
        {settings.licenseKey ? (
          <div className="upgrade-card upgrade-card-active">
            <div className="upgrade-title">✨ Lumi Pro</div>
            <div className="upgrade-sub">Thanks for supporting indie dev work.</div>
          </div>
        ) : (
          <div className="upgrade-card">
            <div className="upgrade-title">Upgrade to Lumi Pro</div>
            <div className="upgrade-sub">
              ElevenLabs voices · unlimited chat · all characters · $7/mo
            </div>
            <button className="upgrade-btn" onClick={handleUpgrade}>
              Pay with crypto →
            </button>
          </div>
        )}

        {/* ============ Identity ============ */}
        <label className="settings-row">
          <span className="settings-label">Your name</span>
          <input
            className="settings-input"
            value={settings.userName}
            onChange={(e) => onChange({ userName: e.target.value })}
            placeholder="What should I call you?"
          />
        </label>

        <label className="settings-row">
          <span className="settings-label">Current goal</span>
          <input
            className="settings-input"
            value={settings.userGoals}
            onChange={(e) => onChange({ userGoals: e.target.value })}
            placeholder="e.g. finish chapter 4 by Friday"
          />
        </label>

        {/* ============ AI ============ */}
        <label className="settings-row">
          <span className="settings-label">
            OpenRouter API key{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="settings-link"
            >
              (get one)
            </a>
          </span>
          <div className="settings-key-row">
            <input
              className="settings-input"
              type={revealKey ? "text" : "password"}
              value={settings.openRouterKey}
              onChange={(e) => onChange({ openRouterKey: e.target.value })}
              placeholder="sk-or-v1-…"
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

        <label className="settings-row">
          <span className="settings-label">Model</span>
          <select
            className="settings-input"
            value={settings.model}
            onChange={(e) => onChange({ model: e.target.value })}
          >
            {RECOMMENDED_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-row">
          <span className="settings-label">Personality</span>
          <select
            className="settings-input"
            value={settings.personality}
            onChange={(e) => onChange({ personality: e.target.value as PersonalityMode })}
          >
            {PERSONALITY_MODES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="settings-hint">
            {PERSONALITY_MODES.find((p) => p.id === settings.personality)?.description}
          </span>
        </label>

        {/* ============ Voice ============ */}
        {tts?.supported ? (
          <label className="settings-row">
            <span className="settings-label">Voice</span>
            <div className="settings-key-row">
              <select
                className="settings-input"
                value={tts.voiceId}
                onChange={(e) => tts.setVoiceId(e.target.value)}
              >
                {tts.voices.length === 0 ? <option value="">(loading…)</option> : null}
                {tts.voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                onClick={() => tts.speak("Hi! I'll keep you company while you work.")}
                title="Test voice"
                aria-label="Test voice"
              >
                ▶
              </button>
            </div>
          </label>
        ) : null}

        {/* ============ License (paste after purchase) ============ */}
        <label className="settings-row">
          <span className="settings-label">License key (Pro)</span>
          <input
            className="settings-input"
            type="text"
            value={settings.licenseKey}
            onChange={(e) => onChange({ licenseKey: e.target.value })}
            placeholder="Paste the key from your purchase email"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </label>

        {/* ============ Help ============ */}
        {onShowPomodoroInfo ? (
          <button type="button" className="settings-help-link" onClick={onShowPomodoroInfo}>
            What's a Pomodoro? →
          </button>
        ) : null}

        <div className="settings-note">
          API key stored locally on this device only.
          <br />
          Drop your own <code>.vrm</code> at <code>public/vrm/character.vrm</code> to swap the model.
        </div>
      </div>
    </div>
  );
}
