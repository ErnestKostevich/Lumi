import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PROVIDERS, pingProvider, type Provider } from "../lib/llm";
import { PERSONALITY_MODES, type PersonalityMode } from "../lib/personality";
import { ELEVEN_VOICE_PRESETS } from "../lib/elevenlabs";
import { checkoutUrl, recoverLicenseByEmail } from "../lib/config";
import type { Settings } from "../hooks/useSettings";
import type { MemoryFact } from "../lib/memory";
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
  /** Long-term memory facts + controls (from useMemory). */
  memoryFacts?: MemoryFact[];
  onForgetFact?: (id: string) => void;
  onClearMemory?: () => void;
}

export function SettingsModal({
  open,
  onClose,
  settings,
  onChange,
  tts,
  onShowPomodoroInfo,
  memoryFacts = [],
  onForgetFact,
  onClearMemory,
}: Props) {
  const [revealKey, setRevealKey] = useState(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverState, setRecoverState] = useState<"idle" | "sending" | "sent" | "fail">("idle");
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
      setTestMsg("Works!");
    } else {
      setTestState("fail");
      setTestMsg(res.reason || "Couldn't reach the model");
    }
  };

  const handleRecover = async () => {
    if (!recoverEmail.trim()) return;
    setRecoverState("sending");
    const res = await recoverLicenseByEmail(recoverEmail.trim());
    setRecoverState(res.ok ? "sent" : "fail");
  };

  const providerShortName = (() => {
    switch (settings.provider) {
      case "mistral": return "Mistral";
      case "openai": return "OpenAI";
      case "anthropic": return "Anthropic";
      default: return "OpenRouter";
    }
  })();

  const switchProvider = (newProvider: Provider) => {
    // When switching providers, also reset model to that provider's default
    // (the old model id is likely invalid for the new endpoint).
    const newCfg = PROVIDERS[newProvider];
    onChange({ provider: newProvider, model: newCfg.defaultModel });
  };

  const handleUpgrade = async () => {
    const url = checkoutUrl("pro");
    console.log("[Upgrade] opening URL:", url);
    let opened = false;
    // Primary path — Tauri plugin-opener, calls OS default browser.
    try {
      await openUrl(url);
      opened = true;
      console.log("[Upgrade] openUrl returned ok");
    } catch (err) {
      console.warn("[Upgrade] openUrl failed:", err);
    }
    // Fallback — browser window.open. In Tauri WebView this usually opens
    // the URL in the system default browser thanks to the plugin's window
    // navigation handler.
    if (!opened) {
      try {
        const w = window.open(url, "_blank", "noopener,noreferrer");
        opened = !!w;
        console.log("[Upgrade] window.open returned", opened);
      } catch (err) {
        console.warn("[Upgrade] window.open failed:", err);
      }
    }
    // Last-resort — show the URL so the user can copy/paste manually.
    if (!opened) {
      // eslint-disable-next-line no-alert
      alert(`Open this URL in your browser to upgrade:\n\n${url}`);
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
        {/* ============ Pro upgrade card — single clickable button ============ */}
        {settings.licenseKey ? (
          <div className="upgrade-card upgrade-card-active">
            <div className="upgrade-title">✨ Lumi Pro active</div>
            <div className="upgrade-sub">Thanks for supporting indie dev work.</div>
          </div>
        ) : (
          <button
            type="button"
            className="upgrade-pill"
            onClick={handleUpgrade}
            title="Open Lumi Pro checkout in your browser"
          >
            <span className="upgrade-pill-main">
              ✨ Upgrade to Lumi Pro <span className="upgrade-pill-arrow">→</span>
            </span>
            <span className="upgrade-pill-sub">
              ElevenLabs voice · $7/month
            </span>
          </button>
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
            {providerShortName} API key{" "}
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
          <div className="settings-test-row">
            <button
              type="button"
              className="settings-test-btn"
              onClick={runTest}
              disabled={!currentKey.trim() || testState === "testing"}
            >
              {testState === "testing" ? "Testing…" : "Test key"}
            </button>
            {testState === "ok" ? <span className="settings-test ok">✓ {testMsg}</span> : null}
            {testState === "fail" ? <span className="settings-test fail">✗ {testMsg}</span> : null}
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
        <div className={`settings-section ${settings.licenseKey ? "" : "settings-section-locked"}`}>
          <span className="settings-section-title">
            ✨ Pro voice — ElevenLabs
            {settings.licenseKey ? null : (
              <span className="settings-lock-badge">🔒 Pro only</span>
            )}
          </span>
          {settings.licenseKey ? (
            <>
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
            </>
          ) : (
            <div className="settings-locked-hint">
              Unlock anime voices + real-time amplitude lip-sync.
              <button type="button" className="settings-locked-cta" onClick={handleUpgrade}>
                Upgrade to Pro →
              </button>
            </div>
          )}
        </div>

        {/* ============ Memory ============ */}
        <div className="settings-section">
          <span className="settings-section-title">🧠 What Lumi remembers</span>
          <label className="settings-row settings-row-inline">
            <input
              type="checkbox"
              checked={settings.memoryEnabled}
              onChange={(e) => onChange({ memoryEnabled: e.target.checked })}
            />
            <span className="settings-label settings-label-inline">
              Remember our conversations (projects, goals, wins)
            </span>
          </label>
          {settings.memoryEnabled ? (
            memoryFacts.length === 0 ? (
              <span className="settings-hint">
                Nothing yet — chat a bit and I'll start remembering what matters. Stored only on
                this device.
              </span>
            ) : (
              <>
                <div className="memory-list">
                  {memoryFacts.map((f) => (
                    <div key={f.id} className="memory-item">
                      <span className={`memory-chip memory-chip-${f.category}`}>{f.category}</span>
                      <span className="memory-text">{f.text}</span>
                      {onForgetFact ? (
                        <button
                          type="button"
                          className="memory-forget"
                          onClick={() => onForgetFact(f.id)}
                          title="Forget this"
                          aria-label="Forget this"
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {onClearMemory ? (
                  <button type="button" className="memory-clear" onClick={onClearMemory}>
                    Forget everything
                  </button>
                ) : null}
              </>
            )
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
          {settings.licenseKey && settings.licenseValid ? (
            <span className="settings-hint">✓ Pro verified{settings.licensePlan ? ` (${settings.licensePlan})` : ""}.</span>
          ) : null}
        </label>

        {/* ============ Lost key recovery ============ */}
        <div className="settings-section">
          <span className="settings-section-title">Lost your key?</span>
          <div className="settings-key-row">
            <input
              className="settings-input"
              type="email"
              value={recoverEmail}
              onChange={(e) => { setRecoverEmail(e.target.value); setRecoverState("idle"); }}
              placeholder="Email used at purchase"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            <button
              type="button"
              className="settings-test-btn"
              onClick={handleRecover}
              disabled={!recoverEmail.trim() || recoverState === "sending"}
            >
              {recoverState === "sending" ? "Sending…" : "Resend"}
            </button>
          </div>
          {recoverState === "sent" ? (
            <span className="settings-test ok">✓ If that email bought Lumi, the key is on its way.</span>
          ) : null}
          {recoverState === "fail" ? (
            <span className="settings-test fail">✗ Couldn't send — check the email or try later.</span>
          ) : null}
        </div>

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
