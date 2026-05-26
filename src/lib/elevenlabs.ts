/**
 * ElevenLabs streaming TTS — Pro-tier voice option.
 *
 * Flash v2.5 model: ~75ms first-byte latency, $0.5-1/1K chars. Best for
 * real-time chat. Recommended anime-style voices from the public Voice
 * Library: tagged "anime", "young female", "japanese" — paste IDs below or
 * let user pick in Settings.
 *
 * Lip-sync: returns a real-time amplitude callback by running the playback
 * audio through a WebAudio AnalyserNode → RMS. Much more accurate than the
 * simulated amplitude we use for Web Speech.
 */

export interface ElevenStreamOptions {
  apiKey: string;
  voiceId: string;
  text: string;
  onAmplitude: (level: number) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
  modelId?: string;
  stability?: number;
  similarity?: number;
  signal?: AbortSignal;
}

/** Curated anime-style voices from the public Voice Library. User can override. */
export const ELEVEN_VOICE_PRESETS: { id: string; label: string; note?: string }[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel", note: "warm female, en-US (default)" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi", note: "energetic young female" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella", note: "soft expressive" },
  { id: "ThT5KcBeYPX3keUQqHPh", label: "Dorothy", note: "British cheerful" },
  { id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte", note: "soothing UK" },
];

export async function speakEleven(opts: ElevenStreamOptions): Promise<void> {
  const {
    apiKey,
    voiceId,
    text,
    onAmplitude,
    onEnd,
    onError,
    modelId = "eleven_flash_v2_5",
    stability = 0.4,
    similarity = 0.75,
    signal,
  } = opts;

  if (!apiKey || !voiceId || !text.trim()) {
    onAmplitude(0);
    onEnd?.();
    return;
  }

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability, similarity_boost: similarity, use_speaker_boost: true },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "<unreadable>");
      throw new Error(`ElevenLabs ${response.status}: ${errText.slice(0, 300)}`);
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.crossOrigin = "anonymous";

    // ---- WebAudio analyser for real lip-sync ----
    const Ctx: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const buf = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      // RMS amplitude → 0..1 for mouth
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const amp = Math.min(1, rms * 2.4); // scale up
      onAmplitude(amp);
      raf = requestAnimationFrame(tick);
    };

    audio.addEventListener("ended", () => {
      cancelAnimationFrame(raf);
      onAmplitude(0);
      URL.revokeObjectURL(audioUrl);
      ctx.close();
      onEnd?.();
    });
    audio.addEventListener("error", () => {
      cancelAnimationFrame(raf);
      onAmplitude(0);
      ctx.close();
      onError?.(new Error("Audio playback failed"));
    });

    if (signal) {
      signal.addEventListener("abort", () => {
        cancelAnimationFrame(raf);
        audio.pause();
        onAmplitude(0);
        URL.revokeObjectURL(audioUrl);
        ctx.close();
      });
    }

    raf = requestAnimationFrame(tick);
    await audio.play();
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onAmplitude(0);
    onError?.(e instanceof Error ? e : new Error(String(e)));
  }
}
