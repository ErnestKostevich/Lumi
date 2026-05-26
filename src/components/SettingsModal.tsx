import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PROVIDERS, type Provider } from "../lib/llm";
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
  backend?: "web" | "eleven";
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
  const providerCfg = PROVIDERS[settings.provider];
  const currentKey =
    settings.provider === "mistral" ? settings.mistralKey : settings.openRouterKey;

  const setProviderKey = (value: string) => {
    if (settings.provider === "mistral") onChange({ mistralKey: value });
    else onChange({ openRouterKey: value });
  };

  const switchProvider = (newProvider: Provider) => {
    // When switching providers, also reset model to that provider's default
    // (the old model id is likely invalid for the new endpoint).
    const newCfg = PROVIDERS[newProvider];
    onChange({ provider: newProvider, model: newCfg.defaultModel });
  };

  const handleUpgrade = async () => {
    const url = checkoutUrl("pro");
    try {
      await openUrl(url);
    } catch (err) {
      console.warn("[Upgrade] openUrl failed, trying window.open", err);
      try {
        window.open(url, "_blank");
      } catch (err2) {
        // Both failed — show the URL inline so user can copy it manually.
        // eslint-disable-next-line no-alert
        prompt("Open this URL in your browser to upgrade:", url);
      }
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

        {/* ============ Provider ============ */}
        <label className="settings-row">
          <span className="settings-label">AI Provider</span>
          <select
            className="settings-input"
            value={settings.provider}
            onChange={(e) => switchProvider(e.target.value as Provider)}
          >
            {Object.values(PROVIDERS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {/* ============ API key for current provider ============ */}
        <label className="settings-row">
          <span className="settings-label">
            {settings.provider === "mistral" ? "Mistral" : "OpenRouter"} API key{" "}
            <a
              href={providerCfg.keyUrl}
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

        <label className="settings-row">
          <span className="settings-label">Model</span>
          <select
            className="settings-input"
            value={settings.model}
            onChange={(e) => onChange({ model: e.target.value })}
          >
            {providerCfg.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.note ? ` — ${m.note}` : ""}
              </option>
            ))}
          </select>
        </label>

        {/* ============ Personality ============ */}
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
            <span className="settings-label">
              Voice
              <label className="voice-toggle">
                <input
                  type="checkbox"
                  checked={settings.showAllVoices}
                  onChange={(e) => onChange({ showAllVoices: e.target.checked })}
                />
                <span>show all (incl. male / non-English)</span>
              </label>
            </span>
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

        {/* ============ ElevenLabs Pro voice ============ */}
        <div className="settings-section">
          <span className="settings-section-title">✨ Pro voice — ElevenLabs</span>
          <label className="settings-row">
            <span className="settings-label">
              ElevenLabs API key{" "}
              <a
                href="https://elevenlabs.io/app/settings/api-keys"
                target="_blank"
                rel="noreferrer"
                className="settings-link"
              >
                (get one)
              </a>
            </span>
            <input
              className="settings-input"
              type="password"
              value={settings.elevenLabsKey}
              onChange={(e) => onChange({ elevenLabsKey: e.target.value })}
              placeholder="sk_... (leave empty to use OS voices)"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </label>
          {settings.elevenLabsKey ? (
            <label className="settings-row">
              <span className="settings-label">ElevenLabs voice</span>
              <input
                className="settings-input"
                value={settings.elevenLabsVoiceId}
                onChange={(e) => onChange({ elevenLabsVoiceId: e.target.value })}
                placeholder="Voice ID — find in elevenlabs.io VoiceLab"
                list="eleven-presets"
              />
              <datalist id="eleven-presets">
                {ELEVEN_VOICE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}{p.note ? ` — ${p.note}` : ""}
                  </option>
                ))}
              </datalist>
              <span className="settings-hint">
                Active backend: {tts?.backend === "eleven" ? "ElevenLabs (Pro)" : "Web Speech"}
              </span>
            </label>
          ) : null}
        </div>

        {/* ============ Behaviour ============ */}
        <label className="settings-row settings-row-inline">
          <input
            type="checkbox"
            checked={settings.hideOnFullscreen}
            onChange={(e) => onChange({ hideOnFullscreen: e.target.checked })}
          />
          <span className="settings-label settings-label-inline">
            Hide when another app is fullscreen (games, video)
          </span>
        </label>

        {/* ============ License ============ */}
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
          API keys stored locally on this device only.
          <br />
          Drop your own <code>.vrm</code> at <code>public/vrm/character.vrm</code> to swap the model.
        </div>
      </div>
    </div>
  );
}
