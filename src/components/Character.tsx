import { useState } from "react";
import { VRMCharacter, type Mood } from "./VRMCharacter";
import { FallbackCharacter } from "./FallbackCharacter";

interface CharacterProps {
  size?: number;
  /** 0..1 mouth-open amount, driven by the TTS hook. */
  mouthAmplitude?: number;
  /** Bumps to trigger reaction expression. */
  reactionTrigger?: number;
  /** Affects idle animation intensity (focus = calmer, break = livelier). */
  mood?: Mood;
  onClick?: () => void;
}

/**
 * Top-level character renderer. Tries to load a VRM 3D avatar; if loading
 * fails (no file, GPU issue, etc.) falls back to the SVG mascot so the user
 * never sees a broken state.
 *
 * The user can drop their own .vrm at /public/vrm/character.vrm to replace
 * the bundled sample.
 */
export function Character({
  size = 280,
  mouthAmplitude = 0,
  reactionTrigger = 0,
  mood = "idle",
  onClick,
}: CharacterProps) {
  const [errored, setErrored] = useState(false);

  return (
    <div
      className="character-wrap"
      style={{ width: size, height: size, position: "relative" }}
      onClick={!errored ? undefined : onClick}
    >
      {!errored ? (
        <VRMCharacter
          size={size}
          mouthAmplitude={mouthAmplitude}
          reactionTrigger={reactionTrigger}
          mood={mood}
          onClick={onClick}
          onError={() => setErrored(true)}
        />
      ) : (
        <FallbackCharacter size={size} />
      )}
    </div>
  );
}
