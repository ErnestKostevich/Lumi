import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const DEFAULT_VRM_PATH = "/vrm/character.vrm";
const FALLBACK_VRM_PATH = "/vrm/sample.vrm";

type LoadState = "loading" | "ready" | "error";
export type Mood = "idle" | "focus" | "break";

interface Props {
  size?: number;
  /** 0..1 — drives the mouth blendshape when TTS is talking. */
  mouthAmplitude?: number;
  /** Increments to trigger a click reaction (random expression). */
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
 *   - Wandering eye look-at (idle drift when cursor still > 8s)
 *   - Periodic wave gesture (every 60-120s)
 *   - Periodic stretch (every 4-5 min — head back + arms up)
 *   - Baseline smile via 'happy' blendshape (0.12)
 *   - Blink, lip-sync, click-reaction (carried over)
 *   - Mood-aware amplitude: focus = calmer, break = livelier
 */

function applyRestPose(vrm: VRM) {
  const set = (name: string, x: number, y: number, z: number) => {
    const bone = vrm.humanoid?.getRawBoneNode(name as never);
    if (bone) bone.rotation.set(x, y, z);
  };
  set("leftUpperArm", 0, 0, 1.2);
  set("rightUpperArm", 0, 0, -1.2);
  set("leftLowerArm", 0, 0, 0.18);
  set("rightLowerArm", 0, 0, -0.18);
  set("leftHand", 0, 0, 0.1);
  set("rightHand", 0, 0, -0.1);
}

/** Smooth ease-in-out cubic (0..1 → 0..1). */
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function VRMCharacter({
  size = 280,
  mouthAmplitude = 0,
  reactionTrigger = 0,
  mood = "idle",
  onReady,
  onError,
  onClick,
}: Props) {
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
    /** TTS lip-sync. */
    mouthAmp: number;
    /** Click reaction state. */
    reaction: { name: string; until: number } | null;
    /** Mood prop mirror (set by effect). */
    mood: Mood;
    /** Cached bone refs + rest-pose base rotations. */
    bones: {
      leftUpperArm: THREE.Object3D | null;
      rightUpperArm: THREE.Object3D | null;
      leftLowerArm: THREE.Object3D | null;
      rightLowerArm: THREE.Object3D | null;
      head: THREE.Object3D | null;
      neck: THREE.Object3D | null;
      chest: THREE.Object3D | null;
      baseLeftUpperArmZ: number;
      baseRightUpperArmZ: number;
      baseLeftLowerArmZ: number;
      baseRightLowerArmZ: number;
    };
    /** Wave gesture scheduling. */
    nextWaveAt: number;
    waveStartedAt: number | null;
    waveDuration: number;
    /** Stretch gesture scheduling. */
    nextStretchAt: number;
    stretchStartedAt: number | null;
    stretchDuration: number;
    /** Eye-drift idle: timestamp of last user-driven look-target change. */
    lastCursorMoveAt: number;
    /** Frame center reference (filled at load) for default look target. */
    frameCenter: { x: number; y: number; z: number };
  }>({
    blinkUntil: 0,
    nextBlinkAt: 0,
    mouthAmp: 0,
    reaction: null,
    mood: "idle",
    bones: {
      leftUpperArm: null,
      rightUpperArm: null,
      leftLowerArm: null,
      rightLowerArm: null,
      head: null,
      neck: null,
      chest: null,
      baseLeftUpperArmZ: 0,
      baseRightUpperArmZ: 0,
      baseLeftLowerArmZ: 0,
      baseRightLowerArmZ: 0,
    },
    nextWaveAt: 0,
    waveStartedAt: null,
    waveDuration: 2200,
    nextStretchAt: 0,
    stretchStartedAt: null,
    stretchDuration: 1800,
    lastCursorMoveAt: 0,
    frameCenter: { x: 0, y: 1.4, z: 0 },
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
    const expressions = ["happy", "surprised", "relaxed", "happy", "happy"];
    const pick = expressions[Math.floor(Math.random() * expressions.length)];
    stateRef.current.reaction = { name: pick, until: performance.now() + 1400 };
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
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();

    const key = new THREE.DirectionalLight(0xfff0f3, 1.4);
    key.position.set(0.8, 2.5, 1.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb4d4ff, 0.5);
    fill.position.set(-1.5, 1.5, -0.5);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
    camera.position.set(0, 1.4, 0.8);
    camera.lookAt(0, 1.4, 0);

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
    stateRef.current.nextWaveAt = now0 + 30_000 + Math.random() * 60_000;
    stateRef.current.nextStretchAt = now0 + 4 * 60_000 + Math.random() * 60_000;
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
          const getBone = (n: string) =>
            (vrm.humanoid?.getRawBoneNode(n as never) as THREE.Object3D | undefined) ?? null;
          const luArm = getBone("leftUpperArm");
          const ruArm = getBone("rightUpperArm");
          const llArm = getBone("leftLowerArm");
          const rlArm = getBone("rightLowerArm");
          const headBone = getBone("head");
          const neckBone = getBone("neck");
          const chestBone =
            getBone("chest") || getBone("upperChest") || getBone("spine");

          stateRef.current.bones = {
            leftUpperArm: luArm,
            rightUpperArm: ruArm,
            leftLowerArm: llArm,
            rightLowerArm: rlArm,
            head: headBone,
            neck: neckBone,
            chest: chestBone,
            baseLeftUpperArmZ: luArm?.rotation.z ?? 0,
            baseRightUpperArmZ: ruArm?.rotation.z ?? 0,
            baseLeftLowerArmZ: llArm?.rotation.z ?? 0,
            baseRightLowerArmZ: rlArm?.rotation.z ?? 0,
          };

          // ---- Camera framing (head + chest down to waist) ----
          let frameTopY = 1.6;
          let frameBottomY = 1.2;
          let frameCenterX = 0;
          let frameCenterY = 1.4;
          let frameCenterZ = 0;
          const frameWidth = 0.55;
          const fullBox = new THREE.Box3().setFromObject(vrm.scene);

          if (headBone) {
            const hp = headBone.getWorldPosition(new THREE.Vector3());
            frameCenterX = hp.x;
            frameCenterZ = hp.z;
            frameTopY = hp.y + 0.18;
            if (chestBone) {
              const cp = chestBone.getWorldPosition(new THREE.Vector3());
              frameBottomY = cp.y - 0.4;
            } else {
              frameBottomY = hp.y - 0.7;
            }
          } else {
            const center = fullBox.getCenter(new THREE.Vector3());
            const sz = fullBox.getSize(new THREE.Vector3());
            frameCenterX = center.x;
            frameCenterZ = center.z;
            frameTopY = fullBox.max.y + 0.05;
            frameBottomY = center.y + sz.y * 0.05;
          }

          const frameHeight = Math.max(0.001, frameTopY - frameBottomY);
          frameCenterY = (frameTopY + frameBottomY) / 2;

          const fovRad = (camera.fov * Math.PI) / 180;
          const distanceH = (frameHeight / 2 / Math.tan(fovRad / 2)) * 1.25;
          const distanceW = (frameWidth / 2 / Math.tan(fovRad / 2)) * 1.1;
          const distance = Math.max(distanceH, distanceW);

          camera.position.set(frameCenterX, frameCenterY, frameCenterZ + distance);
          camera.lookAt(frameCenterX, frameCenterY, frameCenterZ);
          lookTarget.position.set(frameCenterX, frameCenterY + 0.1, frameCenterZ + 1);
          stateRef.current.frameCenter = {
            x: frameCenterX,
            y: frameCenterY,
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

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
      lookTarget.position.copy(v);
      stateRef.current.lastCursorMoveAt = performance.now();
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

        // Mood-based intensity multiplier. Focus = 0.6 (still), break = 1.4 (lively).
        const moodMul =
          s.mood === "focus" ? 0.6 : s.mood === "break" ? 1.4 : 1.0;

        // ---- Procedural blink ----
        const expr = vrm.expressionManager;
        if (expr) {
          if (t < s.blinkUntil) {
            expr.setValue("blink", 1);
          } else {
            expr.setValue("blink", 0);
            if (t > s.nextBlinkAt) {
              s.blinkUntil = t + 130;
              // Faster cycle when lively, slower when focused.
              const base = s.mood === "focus" ? 3500 : s.mood === "break" ? 2400 : 2800;
              s.nextBlinkAt = t + base + Math.random() * base;
            }
          }

          // ---- Baseline soft smile + mouth + reaction ----
          // Subtle baseline happy keeps the face friendly, not blank.
          try {
            expr.setValue("happy", 0.12);
          } catch {
            /* model lacks 'happy' */
          }

          // Lip-sync overrides baseline mouth.
          const amp = s.mouthAmp;
          expr.setValue("aa", Math.max(0, Math.min(1, amp)));

          // Click reaction expression (decays smoothly over 1.4s).
          const reaction = s.reaction;
          if (reaction) {
            if (t < reaction.until) {
              const remaining = (reaction.until - t) / 1400;
              const eased = Math.sin(remaining * Math.PI);
              try {
                // Layer on top of baseline smile (so it adds, not replaces).
                expr.setValue(reaction.name, Math.min(1, 0.12 + eased));
              } catch {
                /* ignore */
              }
            } else {
              try {
                expr.setValue(reaction.name, 0.12);
              } catch {
                /* ignore */
              }
              s.reaction = null;
            }
          }
        }

        // ---- Multi-frequency breathing (chest + whole rig) ----
        const phase = t / 1000;
        // Two superimposed sins read more organic than single sin.
        const breath = Math.sin(phase * 1.5) * 0.004 + Math.sin(phase * 2.3) * 0.0015;
        vrm.scene.position.y = breath * moodMul;
        // Slow Y drift around the forced 180° baseline.
        vrm.scene.rotation.y = Math.PI + Math.sin(phase * 0.4) * 0.05 * moodMul;

        // ---- Idle look-around when cursor is still ----
        const idleMs = t - s.lastCursorMoveAt;
        if (idleMs > 8000 && s.lookTarget) {
          // Random-walk drift around the frame center.
          const dx = Math.sin(phase * 0.35) * 0.4 + Math.sin(phase * 0.18) * 0.25;
          const dy = Math.cos(phase * 0.42) * 0.2;
          s.lookTarget.position.set(
            s.frameCenter.x + dx,
            s.frameCenter.y + 0.1 + dy,
            s.frameCenter.z + 1,
          );
        }

        const bones = s.bones;

        // ---- Head + neck idle motion (subtle 3-axis sway) ----
        if (bones.head) {
          bones.head.rotation.z = Math.sin(phase * 0.4) * 0.04 * moodMul;
          bones.head.rotation.x = Math.sin(phase * 0.55) * 0.02 * moodMul;
        }
        if (bones.neck) {
          // Tiny counter-rotation so head+neck don't move as a single rigid block.
          bones.neck.rotation.x = Math.sin(phase * 0.55) * 0.012 * moodMul;
        }

        // ---- Periodic WAVE gesture (every 30s-90s in idle, suppressed in focus) ----
        if (
          s.waveStartedAt === null &&
          t > s.nextWaveAt &&
          s.mood !== "focus"
        ) {
          s.waveStartedAt = t;
        }

        const armSway = Math.sin(phase * 0.7) * 0.025 * moodMul;

        if (s.waveStartedAt !== null && bones.leftUpperArm && bones.leftLowerArm) {
          const elapsed = t - s.waveStartedAt;
          if (elapsed > s.waveDuration) {
            s.waveStartedAt = null;
            const base = s.mood === "break" ? 25_000 : 45_000;
            s.nextWaveAt = t + base + Math.random() * 60_000;
            // Return to baseline next frame
            bones.leftUpperArm.rotation.z = bones.baseLeftUpperArmZ;
            bones.leftLowerArm.rotation.z = bones.baseLeftLowerArmZ;
            bones.leftLowerArm.rotation.x = 0;
          } else {
            const t01 = elapsed / s.waveDuration;
            // arch: 0 → 1 → 0 over duration
            const arch = Math.sin(ease(t01) * Math.PI);
            // Raise left arm (rotate Z towards 0 = horizontal, then a bit beyond)
            bones.leftUpperArm.rotation.z = bones.baseLeftUpperArmZ - arch * 1.4;
            // Forearm comes up + slight wave waggle
            bones.leftLowerArm.rotation.z = bones.baseLeftLowerArmZ - arch * 0.6;
            bones.leftLowerArm.rotation.x =
              arch * Math.sin(elapsed * 0.018) * 0.3; // hand waves side to side
            // Right arm just idle
            if (bones.rightUpperArm) {
              bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ - armSway;
            }
          }
        } else {
          // ---- Normal idle arm sway ----
          if (bones.leftUpperArm) {
            bones.leftUpperArm.rotation.z = bones.baseLeftUpperArmZ + armSway;
          }
          if (bones.rightUpperArm) {
            bones.rightUpperArm.rotation.z = bones.baseRightUpperArmZ - armSway;
          }
          if (bones.leftLowerArm) {
            bones.leftLowerArm.rotation.z = bones.baseLeftLowerArmZ;
            bones.leftLowerArm.rotation.x = 0;
          }
          if (bones.rightLowerArm) {
            bones.rightLowerArm.rotation.z = bones.baseRightLowerArmZ;
            bones.rightLowerArm.rotation.x = 0;
          }
        }

        // ---- Periodic STRETCH (every 4-5min, head back + arms up briefly) ----
        if (
          s.stretchStartedAt === null &&
          t > s.nextStretchAt &&
          s.waveStartedAt === null
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
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className="vrm-canvas"
      onClick={onClick}
      style={{
        width: size,
        height: size,
        display: state === "error" ? "none" : "block",
        cursor: onClick ? "pointer" : "default",
        pointerEvents: onClick ? "auto" : "none",
      }}
    />
  );
}
