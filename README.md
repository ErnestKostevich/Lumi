<div align="center">

# Lumi 🌸

**Your anime study buddy. A 3D kawaii AI character who lives on your desktop, runs your Pomodoros, and nags you when you slip into YouTube.**

[![release](https://img.shields.io/github/v/release/ErnestKostevich/Project-0?include_prereleases&color=ff6789&label=release)](https://github.com/ErnestKostevich/Project-0/releases/latest)
[![license](https://img.shields.io/badge/license-MIT--like-ff6789)](#license)
[![tests](https://img.shields.io/badge/tests-22%2F22%20passing-22c55e)](#tests)
[![platforms](https://img.shields.io/badge/platforms-Win%20%C2%B7%20macOS%20%C2%B7%20Linux-ff6789)](#download)

[**Live site →**](https://lumi-bloom0.vercel.app) · [**Latest release →**](https://github.com/ErnestKostevich/Project-0/releases/latest) · [**Issues →**](https://github.com/ErnestKostevich/Project-0/issues)

</div>

---

## Download

| Platform | File | Size | Notes |
|---|---|---|---|
| 🪟 Windows | [`Lumi_0.0.1_x64-setup.exe`](https://github.com/ErnestKostevich/Project-0/releases/latest) | 17 MB | NSIS installer (recommended) |
| 🪟 Windows | [`Lumi_0.0.1_x64_en-US.msi`](https://github.com/ErnestKostevich/Project-0/releases/latest) | 18 MB | MSI (IT / Group Policy) |
| 🍎 macOS | [`Lumi_0.0.1_aarch64.dmg`](https://github.com/ErnestKostevich/Project-0/releases/latest) | 18 MB | Apple Silicon (M1/M2/M3) |
| 🐧 Linux | [`Lumi_0.0.1_amd64.AppImage`](https://github.com/ErnestKostevich/Project-0/releases/latest) | 90 MB | Portable |
| 🐧 Linux | [`Lumi_0.0.1_amd64.deb`](https://github.com/ErnestKostevich/Project-0/releases/latest) | 19 MB | Debian / Ubuntu |

> **First-run warnings** (no code-signing on alpha):
> - **Windows**: SmartScreen says "unrecognized publisher" → click **More info** → **Run anyway**
> - **macOS**: Right-click `.dmg` → **Open**. After install: System Settings → Privacy & Security → **Open Anyway**
> - **Linux**: `chmod +x Lumi_*.AppImage && ./Lumi_*.AppImage`
>
> Steam release in Q3 will solve signing — Valve auto-signs.

---

## What it does

Lumi is **not** a romance app. Not a girlfriend simulator. She's a productivity coach who happens to look kawaii.

- **3D anime character** lives in a transparent always-on-top window. Breathes, blinks, follows your cursor, waves at you, occasionally stretches.
- **AI chat** via OpenRouter (Claude / GPT / Gemini / Mistral) or native Mistral. Bring your own API key — free forever.
- **4 personality modes** — friendly senpai · sassy · cheerleader · formal. Pick your flavour of nag.
- **Pomodoro 25/5** with mood-aware character reactions.
- **Active-window awareness** — Lumi notices when you've been on YouTube/TikTok for 5+ min and calls you out. Privacy-safe: she only sees the *title* (same data as Task Manager), never pixels.
- **Voice + lip-sync** — Web Speech (free, your OS voices) or ElevenLabs Flash v2.5 (Pro tier).
- **Snap-to-edge** when you drag her near a monitor edge.
- **Hides on fullscreen** game / video.
- **Click on her** → expression reaction + voice line.

## Privacy

- **100% local.** No telemetry. No analytics. No server (beyond optional license validation).
- Your API key never leaves your machine.
- Active-window detection sees the window **title only**, never pixel content or screenshots.
- Chat history persists in `localStorage` on your device.
- Pro license validation is the only network call beyond your LLM provider.

## Pricing

| Tier | Price | What you get |
|---|---|---|
| **Free** | $0 forever | Everything above + BYO API key + OS voices |
| **Pro** | $7 / month | ElevenLabs anime voice with real lip-sync, unlimited chat without API key, future cloud sync, all character DLC |
| **Character DLC** | $5–15 each | Hand-crafted character packs with custom voice, outfits, idle motions (post-launch) |

Pay with crypto via [NOWPayments](https://nowpayments.io/). No card needed, no recurring auto-charge — you'll get a renewal email each month.

---

## Stack

| Layer | Choice |
|---|---|
| Desktop shell | **Tauri 2** (Rust) — transparent always-on-top frameless window, ~17 MB installer |
| Frontend | **React 19** · TypeScript 5 · Vite 7 |
| Character render | **three.js** + **@pixiv/three-vrm** (VRM 3D — VRoid Hub compatible) |
| AI | **OpenRouter** (Claude / GPT / Gemini / Mistral) or native Mistral La Plateforme |
| Voice | **Web Speech API** (free) or **ElevenLabs Flash v2.5** (Pro) |
| Active-window | `active-win-pos-rs` crate (Win / macOS / Linux) |
| Fullscreen detect | `windows-sys` direct Win32 calls on Windows |
| Storage | `localStorage` (SQLite deferred to v0.1.0 — current `sqlx` ecosystem has a broken `windows-future` transitive dep) |
| Payments | **NOWPayments** (crypto invoice) + Vercel Edge Function webhook + HMAC-SHA256 signed licenses |
| Email | **Resend** (license delivery) |
| KV store | **Upstash Redis** (payment records, license lookup) |
| Hosting | **Vercel** (landing + API) |
| CI/CD | GitHub Actions matrix → 3 OS in parallel → softprops/action-gh-release |
| Tests | **Vitest 4** + Testing Library + happy-dom (22/22 passing) |

## Project layout

```
src/                      React + TS frontend
  components/             Character, ChatPanel, SettingsModal, SpeechBubble,
                          PomodoroBar / Info, AuraGlow, ParticleField, CharacterScene,
                          FallbackCharacter, Logo, VRMCharacter, icons/
  hooks/                  useChat, usePomodoro, useSettings, useTTS,
                          useActiveWindow, useSnapToEdge, useHideOnFullscreen
  lib/                    llm.ts (providers), personality.ts (system prompt),
                          elevenlabs.ts (TTS Pro), config.ts (payments),
                          db.ts (chat history)
src-tauri/                Rust + Tauri config
  src/                    main.rs, lib.rs (commands: get_active_window, is_foreground_fullscreen)
  capabilities/           window + opener permissions
  tauri.conf.json         360x540 transparent always-on-top frameless
landing/                  Standalone marketing site (HTML/CSS + Vercel Edge Functions)
  index.html              Hero with live 3D VRM, features, pricing, FAQ, download
  api/                    /checkout /webhook /verify-license /health
  lib/                    nowpayments, license, email, kv
public/vrm/               Bundled VRM models (sample.vrm = Sendagaya_Shino CC0)
.github/workflows/        CI: matrix build for 3 OS + single publish job
memory/                   Project context (Claude Code sessions)
```

## Develop

### Prereqs

- **Node 22+** and **pnpm 11+**
- **Rust stable** (`rustup default stable`)
- **Windows**: Visual Studio Build Tools 2022 with "Desktop development with C++"
- **macOS**: Xcode CLT (`xcode-select --install`)
- **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

### Run

```bash
pnpm install
pnpm tauri dev           # desktop app
pnpm landing             # marketing page on http://localhost:4173
pnpm test                # unit tests (22/22)
```

### Build production binaries

```bash
pnpm tauri build
# → src-tauri/target/release/bundle/
#   Windows: msi/*.msi  nsis/*-setup.exe
#   macOS:   dmg/*.dmg
#   Linux:   appimage/*.AppImage  deb/*.deb
```

GitHub Actions auto-builds for all 3 platforms on `v*` tag push, then `publish` job aggregates into a single Release with installers attached.

## Customise your character

Drop any VRM file at `public/vrm/character.vrm` and Lumi will load it instead of the bundled Sendagaya Shino. Free anime VRMs from:

- [VRoid Hub](https://hub.vroid.com/en) (filter by "Commercial use OK")
- [VRoid Studio](https://vroid.com/en/studio) (build your own in ~30 min)
- [Open Source Avatars](https://www.opensourceavatars.com/en) (300+ CC0)

## Roadmap

- macOS x86_64 + Linux ARM builds (currently arm64 Mac / amd64 Linux only)
- Custom commissioned VRM character DLC store ($5–15 each)
- Cloud chat history sync (Pro)
- Steam release Q3 — solves SmartScreen + Gatekeeper warnings, brings auto-updates
- SQLite chat persistence via `rusqlite` (replaces `localStorage` once `sqlx` ecosystem stabilises)
- Vision (Pro+, opt-in) — Lumi can see your screen for code review / writing help
- iOS / Android (maybe — VRM on mobile is tricky)

## Acknowledgements

- **Sendagaya_Shino.vrm** — CC0 model from [madjin/vrm-samples](https://github.com/madjin/vrm-samples) by VRoid
- **@pixiv/three-vrm** — Pixiv's official VRM loader for three.js
- **active-win-pos-rs** — cross-platform foreground window detection
- **Tauri**, **softprops/action-gh-release**, **NOWPayments**, **Resend**, **Upstash**, **Vercel**
- One-person indie dev project — feedback / bug reports welcome in [Issues](https://github.com/ErnestKostevich/Project-0/issues)

## License

The source code in this repo is provided for transparency and feedback. The **binary distribution** (downloads from [Releases](https://github.com/ErnestKostevich/Project-0/releases)) and the **trademark "Lumi"** are owned by the project. Commercial use, redistribution, and forking-as-competitor are not granted by default — open an issue if you have a use case.

Bundled assets (VRM character, Live2D Hiyori samples, Cubism Core) retain their original licenses (CC0 / Cubism SDK Release License). Source files are MIT-style for educational reading.

---

<div align="center">
<sub>Made with 🌸 by one indie dev. If Lumi makes your day better, <a href="https://lumi-bloom0.vercel.app/#pricing">support the project</a>.</sub>
</div>
