import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const DEFAULT_VRM_PATH = "/vrm/character.vrm";
const FALLBACK_VRM_PATH = "/vrm/sample.vrm";

type LoadState = "loading" | "ready" | "error";
export type Mood = "idle" | "focus" | "break";

interface Props {
  /** Legacy square-canvas size. Used as both width and height if width/height not given. */
  size?: number;
  width?: number;
  height?: number;
  /** 0..1 — drives the mouth blendshape when TTS is talking. */
  mouthAmplitude?: number;
  /** Increments to trigger a click reaction (random expression + bounce). */
  reactionTrigger?: number;
  /** Affects animation intensity (focus = calmer, break = livelier). */
  mood?: Mood;
  onReady?: () => void;
  onError?: () => void;
  onClick?: () => void;
}

/**
 * VRM avatar with rich procedural idle animations:
 *   - Multi-frequency breathing (chest rise + subtle head bob)
 *   - Spine + hip sway (weight shift, slow 7s cycle)
 *   - Leg micro-twist matching hips (so legs don't look static)
 *   - Wandering eye look-at (idle drift when cursor still > 8s)
 *   - Head tilts subtly toward cursor when cursor recently moved
 *   - Periodic wave / peace-sign gesture (alternating, every 30-90s)
 *   - Periodic stretch (every 4-5 min — head back + arms up)
 *   - Periodic shoulder shrug (every 3-4 min, brief)
 *   - Wink (1 in 4 blinks — left eye only, ~250ms)
 *   - Baseline soft smile via 'happy' blendshape (0.18)
 *   - Click reaction → random kawaii expression burst (1.4s decay)
 *   - Lip-sync via mouth 'aa' blendshape
 *   - Mood-aware amplitude: focus = calmer, break = livelier
 *
 * Camera frames full body (head crown → toes) so the user sees the entire
 * character including legs and feet.
 */

/** Smooth ease-in-out cubic (0..1 → 0..1). */
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Try several humanoid bone name variants — VRoid exports differ across versions. */
function getBone(vrm: VRM, ...names: string[]): THREE.Object3D | null {
  for (const n of names) {
    const b = vrm.humanoid?.getRawBoneNode(n as never);
    if (b) return b as THREE.Object3D;
  }
  return null;
}

function applyRestPose(vrm: VRM) {
  const set = (b: THREE.Object3D | null, x: number, y: number, z: number) => {
    if (b) b.rotation.set(x, y, z);
  };
  set(getBone(vrm, "leftUpperArm"), 0, 0, 1.2);
  set(getBone(vrm, "rightUpperArm"), 0, 0, -1.2);
  set(getBone(vrm, "leftLowerArm"), 0, 0, 0.18);
  set(getBone(vrm, "rightLowerArm"), 0, 0, -0.18);
  set(getBone(vrm, "leftHand"), 0, 0, 0.1);
  set(getBone(vrm, "rightHand"), 0, 0, -0.1);
}

/** Try setting an expression value — silently ignore models that lack it. */
function trySet(vrm: VRM, name: string, value: number) {
  const expr = vrm.expressionManager;
  if (!expr) return;
  try {
    expr.setValue(name, value);
  } catch {
    /* expression missing on this model */
  }
}

export function VRMCharacter({
  size = 280,
  width,
  height,
  mouthAmplitude = 0,
  reactionTrigger = 0,
  mood = "idle",
  onReady,
  onError,
  onClick,
}: Props) {
  const canvasW = width ?? size;
  const canvasH = height ?? size;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    vrm?: VRM;
    lookTarget?: THREE.Object3D;
    clock?: THREE.Clock;
    raf?: number;
    /** Blink scheduling. */
    blinkUntil: number;
    nextBlinkAt: number;
    /** Wink scheduling (separate from blink). */
    winkUntil: number;
    winkSide: "left" | "right";
    /** TTS lip-sync raw target (0..1). */
    mouthAmp: number;
    /** Smoothed mouth value — lerped each frame for a less jumpy mouth. */
    mouthSmoothed: number;
    /** Click reaction state. */
    reaction: { name: string; until: number } | null;
    /** Mood prop mirror (set by effect). */
    mood: Mood;
    /** Cached bone refs + rest-pose base rotations. */
    bones: {
      hips: THREE.Object3D | null;
      spine: THREE.Object3D | null;
      chest: THREE.Object3D | null;
      neck: THREE.Object3D | null;
      head: THREE.Object3D | null;
      leftShoulder: THREE.Object3D | null;
      rightShoulder: THREE.Object3D | null;
      leftUpperArm: THREE.Object3D | null;
      rightUpperArm: THREE.Object3D | null;
      leftLowerArm: THREE.Object3D | null;
      rightLowerArm: THREE.Object3D | null;
      leftUpperLeg: THREE.Object3D | null;
      rightUpperLeg: THREE.Object3D | null;
      leftLowerLeg: THREE.Object3D | null;
      rightLowerLeg: THREE.Object3D | null;
      baseLeftUpperArmZ: number;
      baseRightUpperArmZ: number;
      baseLeftLowerArmZ: number;
      baseRightLowerArmZ: number;
      baseLeftShoulderZ: number;
      baseRightShoulderZ: number;
    };
    /** Gesture scheduling — wave + peace alternate. */
    nextGestureAt: number;
    gestureStartedAt: number | null;
    gestureType: "wave" | "peace";
    gestureDuration: number;
    /** Stretch gesture scheduling. */
    nextStretchAt: number;
    stretchStartedAt: number | null;
    stretchDuration: number;
    /** Shoulder shrug scheduling. */
    nextShrugAt: number;
    shrugStartedAt: number | null;
    shrugDuration: number;
    /** Micro-gesture scheduling — short cute moves every 7-15s. */
    nextMicroAt: number;
    microStartedAt: number | null;
    microType: "headTilt" | "handWiggle" | "lean" | "hairTouch";
    microDuration: number;
    microSide: 1 | -1;
    /** Eye-drift idle: timestamp of last user-driven look-target change. */
    lastCursorMoveAt: number;
    /** Cursor delta-x from canvas center (-1..1), drives head tilt. */
    cursorDeltaX: number;
    /** Click bounce — slight upward scale pulse 0..1, decays. */
    clickPulse: number;
    /** Frame center reference (filled at load) for default look target. */
    frameCenter: { x: number; y: number; z: number };
  }>({
    blinkUntil: 0,
    nextBlinkAt: 0,
    winkUntil: 0,
    winkSide: "left",
    mouthAmp: 0,
    mouthSmoothed: 0,
    reaction: null,
    mood: "idle",
    bones: {
      hips: null,
      spine: null,
      chest: null,
      neck: null,
      head: null,
      leftShoulder: null,
      rightShoulder: null,
      leftUpperArm: null,
      rightUpperArm: null,
      leftLowerArm: null,
      rightLowerArm: null,
      leftUpperLeg: null,
      rightUpperLeg: null,
      leftLowerLeg: null,
      rightLowerLeg: null,
      baseLeftUpperArmZ: 0,
      baseRightUpperArmZ: 0,
      baseLeftLowerArmZ: 0,
      baseRightLowerArmZ: 0,
      baseLeftShoulderZ: 0,
      baseRightShoulderZ: 0,
    },
    nextGestureAt: 0,
    gestureStartedAt: null,
    gestureType: "wave",
    gestureDuration: 2200,
    nextStretchAt: 0,
    stretchStartedAt: null,
    stretchDuration: 1800,
    nextShrugAt: 0,
    shrugStartedAt: null,
    shrugDuration: 1200,
    nextMicroAt: 0,
    microStartedAt: null,
    microType: "headTilt",
    microDuration: 1100,
    microSide: 1,
    lastCursorMoveAt: 0,
    cursorDeltaX: 0,
    clickPulse: 0,
    frameCenter: { x: 0, y: 0.9, z: 0 },
  });
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    stateRef.current.mouthAmp = mouthAmplitude;
  }, [mouthAmplitude]);

  useEffect(() => {
    stateRef.current.mood = mood;
  }, [mood]);

  useEffect(() => {
    if (!reactionTrigger) return;
    // Kawaii flirty SFW reactions — happy/relaxed/surprised are the only safe expressions
    // VRoid Shino reliably ships. Bias toward happy (Lumi is friendly first).
    const expressions = ["happy", "happy", "happy", "relaxed", "surprised"];
    const pick = expressions[Math.floor(Math.random() * expressions.length)];
    stateRef.current.reaction = { name: pick, until: performance.now() + 1400 };
    stateRef.current.clickPulse = 1; // bounce
  }, [reactionTrigger]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(canvasW, canvasH, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();

    const key = new THREE.DirectionalLight(0xfff0f3, 1.4);
    key.position.set(0.8, 2.5, 1.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb4d4ff, 0.5);
    fill.position.set(-1.5, 1.5, -0.5);
    scene.add(fill);
    // Soft rim light from behind for hair edge
    const rim = new THREE.DirectionalLight(0xffd0e0, 0.35);
    rim.position.set(0, 1.6, -2);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const camera = new THREE.PerspectiveCamera(28, canvasW / canvasH, 0.05, 20);
    camera.position.set(0, 0.9, 2);
    camera.lookAt(0, 0.9, 0);

    const lookTarget = new THREE.Object3D();
    lookTarget.position.set(0, 1.4, 1);
    scene.add(lookTarget);

    const clock = new THREE.Clock();

    stateRef.current.renderer = renderer;
    stateRef.current.scene = scene;
    stateRef.current.camera = camera;
    stateRef.current.lookTarget = lookTarget;
    stateRef.current.clock = clock;
    const now0 = performance.now();
    stateRef.current.nextBlinkAt = now0 + 2500 + Math.random() * 2500;
    stateRef.current.nextGestureAt = now0 + 30_000 + Math.random() * 60_000;
    stateRef.current.nextStretchAt = now0 + 4 * 60_000 + Math.random() * 60_000;
    stateRef.current.nextShrugAt = now0 + 3 * 60_000 + Math.random() * 60_000;
    stateRef.current.nextMicroAt = now0 + 4_000 + Math.random() * 3_000;
    stateRef.current.lastCursorMoveAt = now0;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const tryLoad = (path: string, isFallback = false) => {
      loader.load(
        path,
        (gltf) => {
          if (disposed) return;
          const vrm = gltf.userData.vrm as VRM | undefined;
          if (!vrm) {
            if (!isFallback) tryLoad(FALLBACK_VRM_PATH, true);
            else {
              setState("error");
              onError?.();
            }
            return;
          }

          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
          });

          VRMUtils.rotateVRM0(vrm);
          vrm.scene.rotation.y += Math.PI;
          vrm.scene.updateMatrixWorld(true);

          applyRestPose(vrm);
          vrm.scene.updateMatrixWorld(true);

          scene.add(vrm.scene);
          stateRef.current.vrm = vrm;

          // Cache all bones we animate.
          const hips = getBone(vrm, "hips");
          const spine = getBone(vrm, "spine");
          const chest =
            getBone(vrm, "chest") ||
            getBone(vrm, "upperChest") ||
            spine;
          const neck = getBone(vrm, "neck");
          const headBone = getBone(vrm, "head");
          const lSh = getBone(vrm, "leftShoulder");
          const rSh = getBone(vrm, "rightShoulder");
          const luArm = getBone(vrm, "leftUpperArm");
          const ruArm = getBone(vrm, "rightUpperArm");
          const llArm = getBone(vrm, "leftLowerArm");
          const rlArm = getBone(vrm, "rightLowerArm");
          const luLeg = getBone(vrm, "leftUpperLeg");
          const ruLeg = getBone(vrm, "rightUpperLeg");
          const llLeg = getBone(vrm, "leftLowerLeg");
          const rlLeg = getBone(vrm, "rightLowerLeg");

          stateRef.current.bones = {
            hips,
            spine,
            chest,
            neck,
            head: headBone,
            leftShoulder: lSh,
            rightShoulder: rSh,
            leftUpperArm: luArm,
            rightUpperArm: ruArm,
            leftLowerArm: llArm,
            rightLowerArm: rlArm,
            leftUpperLeg: luLeg,
            rightUpperLeg: ruLeg,
            leftLowerLeg: llLeg,
            rightLowerLeg: rlLeg,
            baseLeftUpperArmZ: luArm?.rotation.z ?? 0,
            baseRightUpperArmZ: ruArm?.rotation.z ?? 0,
            baseLeftLowerArmZ: llArm?.rotation.z ?? 0,
            baseRightLowerArmZ: rlArm?.rotation.z ?? 0,
            baseLeftShoulderZ: lSh?.rotation.z ?? 0,
            baseRightShoulderZ: rSh?.rotation.z ?? 0,
          };

          // ---- Camera framing: FULL BODY (head crown → soles) ----
          // Width covers comfortable arm extension during gestures.
          const fullBox = new THREE.Box3().setFromObject(vrm.scene);
          let frameTopY = fullBox.max.y + 0.08;
          let frameBottomY = fullBox.min.y - 0.05;
          let frameCenterX = 0;
          let frameCenterZ = 0;
          const frameWidth = 0.75;

          if (headBone) {
            const hp = headBone.getWorldPosition(new THREE.Vector3());
            frameCenterX = hp.x;
            frameCenterZ = hp.z;
            frameTopY = hp.y + 0.18;
          }
          // Prefer toes / foot bone for bottom — fullBox.min sometimes includes
          // hair tips dangling past the feet on certain VRoid models.
          const lToe = getBone(vrm, "leftToes") || getBone(vrm, "leftFoot");
          const rToe = getBone(vrm, "rightToes") || getBone(vrm, "rightFoot");
          const footY =
            lToe && rToe
              ? Math.min(
                  lToe.getWorldPosition(new THREE.Vector3()).y,
                  rToe.getWorldPosition(new THREE.Vector3()).y,
                )
              : lToe
                ? lToe.getWorldPosition(new THREE.Vector3()).y
                : rToe
                  ? rToe.getWorldPosition(new THREE.Vector3()).y
                  : fullBox.min.y;
          frameBottomY = footY - 0.04;

          const frameHeight = Math.max(0.001, frameTopY - frameBottomY);
          const frameCenterY = (frameTopY + frameBottomY) / 2;

          const aspect = canvasW / canvasH;
          const fovRadV = (camera.fov * Math.PI) / 180;
          // Vertical fit
          const distanceH = (frameHeight / 2 / Math.tan(fovRadV / 2)) * 1.06;
          // Horizontal fit — horizontal FOV depends on aspect
          const fovRadH = 2 * Math.atan(Math.tan(fovRadV / 2) * aspect);
          const distanceW = (frameWidth / 2 / Math.tan(fovRadH / 2)) * 1.06;
          const distance = Math.max(distanceH, distanceW);

          camera.position.set(frameCenterX, frameCenterY, frameCenterZ + distance);
          camera.lookAt(frameCenterX, frameCenterY, frameCenterZ);
          // Default look target at head height (where her gaze rests by default).
          const headY = headBone
            ? headBone.getWorldPosition(new THREE.Vector3()).y
            : frameCenterY + frameHeight * 0.35;
          lookTarget.position.set(frameCenterX, headY, frameCenterZ + 1);
          stateRef.current.frameCenter = {
            x: frameCenterX,
            y: headY,
            z: frameCenterZ,
          };

          if (vrm.lookAt) vrm.lookAt.target = lookTarget;

          setState("ready");
          onReady?.();
        },
        undefined,
        (err) => {
          console.warn("[VRMCharacter] load failed", path, err);
          if (!isFallback) tryLoad(FALLBACK_VRM_PATH, true);
          else {
            setState("error");
            onError?.();
          }
        },
      );
    };
    tryLoad(DEFAULT_VRM_PATH);

    // Track cursor only when it's over THIS canvas — global mousemove was too
    // jittery (Lumi would yank her head every time the user moved across the
    // window for unrelated buttons).
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      // Outside canvas? Don't track — return to idle gaze.
      if (Math.abs(ndcX) > 1.05 || Math.abs(ndcY) > 1.05) return;
      const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
      lookTarget.position.copy(v);
      stateRef.current.lastCursorMoveAt = performance.now();
      stateRef.current.cursorDeltaX = ndcX;
    };
    window.addEventListener("mousemove", onMouseMove);

    const tick = () => {
      if (disposed) return;
      const t = performance.now();
      const dt = clock.getDelta();
      const vrm = stateRef.current.vrm;
      const s = stateRef.current;

      if (vrm) {
        vrm.update(dt);

        // Mood-based intensity multiplier. Focus = 0.55 (still), break = 1.45 (lively).
        const moodMul =
          s.mood === "focus" ? 0.55 : s.mood === "break" ? 1.45 : 1.0;
        const phase = t / 1000;

        // ---- Procedural blink + occasional wink ----
        const expr = vrm.expressionManager;
        if (expr) {
          // Wink active?
          if (t < s.winkUntil) {
            const winkExpr =
              s.winkSide === "left"
                ? ["blinkLeft", "blink_l", "Blink_L"]
                : ["blinkRight", "blink_r", "Blink_R"];
            for (const n of winkExpr) trySet(vrm, n, 1);
            trySet(vrm, "blink", 0);
          } else if (t < s.blinkUntil) {
            trySet(vrm, "blink", 1);
            trySet(vrm, "blinkLeft", 0);
            trySet(vrm, "blinkRight", 0);
            trySet(vrm, "blink_l", 0);
            trySet(vrm, "blink_r", 0);
          } else {
            trySet(vrm, "blink", 0);
            trySet(vrm, "blinkLeft", 0);
            trySet(vrm, "blinkRight", 0);
            trySet(vrm, "blink_l", 0);
            trySet(vrm, "blink_r", 0);
            if (t > s.nextBlinkAt) {
              // 22% chance this blink is actually a playful wink
              if (Math.random() < 0.22) {
                s.winkUntil = t + 260;
                s.winkSide = Math.random() < 0.5 ? "left" : "right";
              } else {
                s.blinkUntil = t + 130;
              }
              const base = s.mood === "focus" ? 3500 : s.mood === "break" ? 2400 : 2800;
              s.nextBlinkAt = t + base + Math.random() * base;
            }
          }

          // ---- Baseline soft smile + lip-sync + reaction ----
          // Slightly bumped to 0.18 — friendly resting face, not blank.
          trySet(vrm, "happy", 0.18);

          // Lip-sync — cap + smooth so the mouth doesn't gape wide open or
          // snap shut between syllables. Web Speech amplitude is simulated
          // (random walk 0.3-0.95) so smoothing is essential.
          // Cap target at 0.45 — a half-open mouth reads as natural speech;
          // full 1.0 looks like screaming.
          const ampTarget = Math.max(0, Math.min(0.45, s.mouthAmp * 0.55));
          // Asymmetric lerp: open quickly (0.35), close slower (0.18) — natural
          // mouth dynamics.
          const lerpK = ampTarget > s.mouthSmoothed ? 0.35 : 0.18;
          s.mouthSmoothed += (ampTarget - s.mouthSmoothed) * lerpK;
          trySet(vrm, "aa", s.mouthSmoothed);

          // Click reaction — decays smoothly over 1.4s on top of baseline.
          // Suppressed during speech so we don't get a weird "wide smile +
          // open mouth + head sway" combo that read as uncanny.
          const reaction = s.reaction;
          if (reaction && s.mouthSmoothed < 0.05) {
            if (t < reaction.until) {
              const remaining = (reaction.until - t) / 1400;
              const eased = Math.sin(remaining * Math.PI);
              trySet(vrm, reaction.name, Math.min(1, 0.18 + eased));
            } else {
              trySet(vrm, reaction.name, 0.18);
              s.reaction = null;
            }
          } else if (reaction && s.mouthSmoothed >= 0.05) {
            // Reset reaction to baseline while speaking — clear it so it doesn't
            // resume mid-expression when speech ends.
            trySet(vrm, reaction.name, 0.18);
            s.reaction = null;
          }
        }

        // ---- Click pulse (decays exponentially over ~600ms) ----
        if (s.clickPulse > 0) {
          s.clickPulse *= 0.92;
          if (s.clickPulse < 0.01) s.clickPulse = 0;
        }
        // Tiny bounce — character scales up a hair when clicked
        const bounce = 1 + s.clickPulse * 0.04;
        vrm.scene.scale.set(bounce, bounce, bounce);

        // Speech damping — when the mouth is moving (TTS active), reduce idle
        // animation amplitude so the head isn't bobbing dramatically while
        // she's talking. Was creepy at full sway.
        const speechDamp = s.mouthSmoothed > 0.05 ? 0.35 : 1.0;

        // ---- Multi-frequency breathing + whole-body Y drift ----
        // Boosted amplitudes — old values were too subtle, character looked static.
        const breath = Math.sin(phase * 1.5) * 0.012 + Math.sin(phase * 2.3) * 0.004;
        vrm.scene.position.y = breath * moodMul;
        // Slow Y rotation around the forced 180° baseline (visible 5° sway,
        // damped while speaking).
        vrm.scene.rotation.y = Math.PI + Math.sin(phase * 0.4) * 0.09 * moodMul * speechDamp;

        // ---- Hip + spine sway (weight shift, ~7s cycle) ----
        // ROTATION-ONLY — touching hips.position.{x,y} breaks the VRM rig
        // because VRMHumanoid expects bone *rotations* relative to rest, but
        // positions are part of the skeleton at-rest layout. Setting them
        // absolutely yanked the hips down to ~0m and chopped the legs off frame.
        const bones = s.bones;
        const hipPhase = phase * 0.45;
        const hipSway = Math.sin(hipPhase) * 0.10 * moodMul; // softened from 0.14 → 0.10
        if (bones.hips) {
          bones.hips.rotation.y = hipSway;
          bones.hips.rotation.z = Math.sin(hipPhase) * 0.025 * moodMul; // soft side tilt
        }
        // Counter-rotate spine/chest so torso stays facing forward — looks natural.
        if (bones.spine) {
          bones.spine.rotation.y = -hipSway * 0.5;
          bones.spine.rotation.z = Math.sin(hipPhase + 0.3) * 0.03 * moodMul;
        }
        if (bones.chest && bones.chest !== bones.spine) {
          bones.chest.rotation.y = -hipSway * 0.25;
        }
        // Legs follow hips with visible matching twist. Knee bend kept subtle.
        if (bones.leftUpperLeg) {
          bones.leftUpperLeg.rotation.y = -hipSway * 0.35;
          bones.leftUpperLeg.rotation.x = Math.sin(hipPhase) * 0.025 * moodMul;
        }
        if (bones.rightUpperLeg) {
          bones.rightUpperLeg.rotation.y = -hipSway * 0.35;
          bones.rightUpperLeg.rotation.x = -Math.sin(hipPhase) * 0.025 * moodMul;
        }
        if (bones.leftLowerLeg) {
          bones.leftLowerLeg.rotation.x = Math.max(0, Math.sin(hipPhase)) * 0.04 * moodMul;
        }
        if (bones.rightLowerLeg) {
          bones.rightLowerLeg.rotation.x = Math.max(0, -Math.sin(hipPhase)) * 0.04 * moodMul;
        }

        // ---- Idle look-around when cursor is still ----
        const idleMs = t - s.lastCursorMoveAt;
        if (idleMs > 8000 && s.lookTarget) {
          const dx = Math.sin(phase * 0.35) * 0.4 + Math.sin(phase * 0.18) * 0.25;
          const dy = Math.cos(phase * 0.42) * 0.15;
          s.lookTarget.position.set(
            s.frameCenter.x + dx,
            s.frameCenter.y + dy,
            s.frameCenter.z + 1,
          );
          // Cursor delta-x decays toward 0 — head returns to neutral tilt.
          s.cursorDeltaX *= 0.94;
        }

        // ---- Head + neck idle motion + cursor-aware tilt ----
        // Boosted: head bobs ~4° + cursor tilt ±10° (kawaii "she's looking at you").
        // Damped to ~35% during speech so head doesn't wobble while talking.
        const headTilt = -s.cursorDeltaX * 0.18 * speechDamp;
        if (bones.head) {
          bones.head.rotation.z =
            Math.sin(phase * 0.4) * 0.07 * moodMul * speechDamp + headTilt;
          bones.head.rotation.x = Math.sin(phase * 0.55) * 0.04 * moodMul * speechDamp;
        }
        if (bones.neck) {
          bones.neck.rotation.x = Math.sin(phase * 0.55) * 0.024 * moodMul * speechDamp;
          bones.neck.rotation.z = headTilt * 0.4;
        }

        // ---- Periodic GESTURE (wave or peace-sign, alternates) ----
        if (
          s.gestureStartedAt === null &&
          t > s.nextGestureAt &&
          s.mood !== "focus"
        ) {
          s.gestureStartedAt = t;
          // Alternate between wave and peace-sign for variety
          s.gestureType = s.gestureType === "wave" ? "peace" : "wave";
        }

        // Boosted arm sway — old 0.025 was barely visible. ~4° visible swing.
        const armSway = Math.sin(phase * 0.7) * 0.07 * moodMul;
        const armSwayX = Math.sin(phase * 0.65 + 0.5) * 0.04 * moodMul; // tiny forward/back too

        if (s.gestureStartedAt !== null && bones.leftUpperArm && bones.leftLowerArm) {
          const elapsed = t - s.gestureStartedAt;
          if (elapsed > s.gestureDuration) {
            s.gestureStartedAt = null;
            const base = s.mood === "break" ? 25_000 : 45_000;
            s.nextGestureAt = t + base + Math.random() * 60_000;
            // Return to baseline next frame
            bones.leftUpperArm.rotation.z = bones.baseLeftUpperArmZ;
            bones.leftLowerArm.rotation.z = bones.baseLeftLowerArmZ;
            bones.leftLowerArm.rotation.x = 0;
            if (bones.rightUpperArm) bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ;
            if (bones.rightLowerArm) {
              bones.rightLowerArm.rotation.z = bones.baseRightLowerArmZ;
              bones.rightLowerArm.rotation.x = 0;
            }
          } else {
            const t01 = elapsed / s.gestureDuration;
            const arch = Math.sin(ease(t01) * Math.PI); // 0 → 1 → 0

            if (s.gestureType === "wave") {
              // Big waving left arm (Lumi's left = viewer's right).
              bones.leftUpperArm.rotation.z = bones.baseLeftUpperArmZ - arch * 1.35;
              bones.leftLowerArm.rotation.z = bones.baseLeftLowerArmZ - arch * 0.55;
              bones.leftLowerArm.rotation.x =
                arch * Math.sin(elapsed * 0.018) * 0.32;
              if (bones.rightUpperArm) {
                bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ - armSway;
              }
            } else {
              // Peace sign — right arm comes up to face level, holds briefly.
              if (bones.rightUpperArm) {
                bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ + arch * 1.15;
              }
              if (bones.rightLowerArm) {
                bones.rightLowerArm.rotation.z = bones.baseRightLowerArmZ + arch * 0.45;
                bones.rightLowerArm.rotation.x = -arch * 0.4; // bring forearm up toward cam
              }
              // Left arm idle
              bones.leftUpperArm.rotation.z = bones.baseLeftUpperArmZ + armSway;
              bones.leftLowerArm.rotation.z = bones.baseLeftLowerArmZ;
              bones.leftLowerArm.rotation.x = 0;
            }
          }
        } else {
          // ---- Normal idle arm sway (visible — boosted from 1.4° to ~4°) ----
          if (bones.leftUpperArm) {
            bones.leftUpperArm.rotation.z = bones.baseLeftUpperArmZ + armSway;
            bones.leftUpperArm.rotation.x = armSwayX;
          }
          if (bones.rightUpperArm) {
            bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ - armSway;
            bones.rightUpperArm.rotation.x = -armSwayX;
          }
          if (bones.leftLowerArm) {
            bones.leftLowerArm.rotation.z = bones.baseLeftLowerArmZ;
            bones.leftLowerArm.rotation.x = armSwayX * 0.5;
          }
          if (bones.rightLowerArm) {
            bones.rightLowerArm.rotation.z = bones.baseRightLowerArmZ;
            bones.rightLowerArm.rotation.x = -armSwayX * 0.5;
          }
        }

        // ---- Periodic STRETCH (every 4-5min, head back + arms up briefly) ----
        if (
          s.stretchStartedAt === null &&
          t > s.nextStretchAt &&
          s.gestureStartedAt === null
        ) {
          s.stretchStartedAt = t;
        }
        if (s.stretchStartedAt !== null) {
          const elapsed = t - s.stretchStartedAt;
          if (elapsed > s.stretchDuration) {
            s.stretchStartedAt = null;
            s.nextStretchAt = t + 4 * 60_000 + Math.random() * 60_000;
          } else {
            const t01 = elapsed / s.stretchDuration;
            const arch = Math.sin(ease(t01) * Math.PI);
            if (bones.head) bones.head.rotation.x = -arch * 0.18;
            if (bones.leftUpperArm) {
              bones.leftUpperArm.rotation.z = bones.baseLeftUpperArmZ + arch * 0.35;
            }
            if (bones.rightUpperArm) {
              bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ - arch * 0.35;
            }
            if (bones.chest) {
              bones.chest.rotation.x = -arch * 0.05;
            }
          }
        }

        // ---- Periodic SHRUG (every 3-4 min, brief shoulder lift) ----
        if (
          s.shrugStartedAt === null &&
          t > s.nextShrugAt &&
          s.gestureStartedAt === null &&
          s.stretchStartedAt === null
        ) {
          s.shrugStartedAt = t;
        }
        if (s.shrugStartedAt !== null) {
          const elapsed = t - s.shrugStartedAt;
          if (elapsed > s.shrugDuration) {
            s.shrugStartedAt = null;
            s.nextShrugAt = t + 3 * 60_000 + Math.random() * 90_000;
            if (bones.leftShoulder) bones.leftShoulder.rotation.z = bones.baseLeftShoulderZ;
            if (bones.rightShoulder) bones.rightShoulder.rotation.z = bones.baseRightShoulderZ;
          } else {
            const t01 = elapsed / s.shrugDuration;
            const arch = Math.sin(ease(t01) * Math.PI);
            if (bones.leftShoulder) {
              bones.leftShoulder.rotation.z = bones.baseLeftShoulderZ + arch * 0.18;
            }
            if (bones.rightShoulder) {
              bones.rightShoulder.rotation.z = bones.baseRightShoulderZ - arch * 0.18;
            }
          }
        }

        // ---- Micro-gestures (every 15-30s, calm cute moves) ----
        // Toned WAY down from the first iteration — previous values felt jumpy
        // and "twitchy" rather than alive. New design: longer duration (1.4-2s),
        // smaller amplitudes, less frequent (15-30s) so each move reads as
        // intentional rather than a spasm.
        if (
          s.microStartedAt === null &&
          t > s.nextMicroAt &&
          s.gestureStartedAt === null &&
          s.stretchStartedAt === null &&
          s.shrugStartedAt === null
        ) {
          s.microStartedAt = t;
          const types: ("headTilt" | "handWiggle" | "lean" | "hairTouch")[] = [
            "headTilt", "headTilt", "lean", "lean", "handWiggle", "hairTouch",
          ];
          s.microType = types[Math.floor(Math.random() * types.length)];
          s.microDuration = 1400 + Math.random() * 700; // slower in/out
          s.microSide = Math.random() < 0.5 ? 1 : -1;
        }
        if (s.microStartedAt !== null) {
          const elapsed = t - s.microStartedAt;
          if (elapsed > s.microDuration) {
            s.microStartedAt = null;
            s.nextMicroAt = t + 15_000 + Math.random() * 15_000;
            // Reset bones that micro-gestures touched (idle sway will set fresh next frame)
            if (s.microType === "hairTouch") {
              if (bones.rightUpperArm) bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ;
              if (bones.rightLowerArm) {
                bones.rightLowerArm.rotation.z = bones.baseRightLowerArmZ;
                bones.rightLowerArm.rotation.x = 0;
              }
            }
          } else {
            const t01 = elapsed / s.microDuration;
            const arch = Math.sin(ease(t01) * Math.PI);
            const side = s.microSide;
            switch (s.microType) {
              case "headTilt":
                // Gentle head tilt + tiny smile bump
                if (bones.head) {
                  bones.head.rotation.z =
                    Math.sin(phase * 0.4) * 0.07 * moodMul + headTilt + arch * 0.14 * side;
                }
                trySet(vrm, "happy", 0.18 + arch * 0.18);
                break;
              case "handWiggle":
                // Very soft waggle of right hand at hip level
                if (bones.rightLowerArm) {
                  bones.rightLowerArm.rotation.x =
                    -armSwayX * 0.5 + arch * Math.sin(elapsed * 0.012) * 0.18;
                }
                break;
              case "lean":
                // Gentle whole-body lean
                if (bones.spine) {
                  bones.spine.rotation.z =
                    Math.sin(hipPhase + 0.3) * 0.03 * moodMul + arch * 0.05 * side;
                }
                if (bones.chest && bones.chest !== bones.spine) {
                  bones.chest.rotation.z = arch * 0.03 * side;
                }
                break;
              case "hairTouch":
                // Right arm reaches up slowly — softened from 1.1 → 0.7 rad
                if (bones.rightUpperArm) {
                  bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ + arch * 0.7;
                  bones.rightUpperArm.rotation.x = -arch * 0.25;
                }
                if (bones.rightLowerArm) {
                  bones.rightLowerArm.rotation.z = bones.baseRightLowerArmZ + arch * 0.4;
                  bones.rightLowerArm.rotation.x = -arch * 0.6;
                }
                break;
            }
          }
        }
      }

      renderer.render(scene, camera);
      stateRef.current.raf = requestAnimationFrame(tick);
    };
    stateRef.current.raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      window.removeEventListener("mousemove", onMouseMove);
      if (stateRef.current.raf) cancelAnimationFrame(stateRef.current.raf);
      const v = stateRef.current.vrm;
      if (v) {
        scene.remove(v.scene);
        VRMUtils.deepDispose(v.scene);
      }
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasW, canvasH]);

  return (
    <canvas
      ref={canvasRef}
      className="vrm-canvas"
      onClick={onClick}
      style={{
        width: canvasW,
        height: canvasH,
        display: state === "error" ? "none" : "block",
        cursor: onClick ? "pointer" : "default",
        pointerEvents: onClick ? "auto" : "none",
      }}
    />
  );
}
