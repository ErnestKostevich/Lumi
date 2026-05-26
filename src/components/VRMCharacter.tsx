import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const DEFAULT_VRM_PATH = "/vrm/character.vrm";
const FALLBACK_VRM_PATH = "/vrm/sample.vrm";

type LoadState = "loading" | "ready" | "error";

interface Props {
  size?: number;
  /** 0..1 — drives the mouth blendshape when TTS is talking. */
  mouthAmplitude?: number;
  /** Increments to trigger a click reaction (random expression). */
  reactionTrigger?: number;
  onReady?: () => void;
  onError?: () => void;
  onClick?: () => void;
}

/**
 * Renders a VRM 3D avatar on a transparent canvas via three.js.
 * - Procedural breathing (gentle bob + scale)
 * - Periodic blink via the model's blink expression
 * - Cursor look-at via VRMLookAt
 * - Mouth blendshape driven by `mouthAmplitude` prop (lip-sync hook)
 *
 * Tries /vrm/character.vrm first (user-supplied), falls back to /vrm/sample.vrm
 * (bundled). If both fail, calls `onError` so the parent can show a fallback.
 */
export function VRMCharacter({
  size = 280,
  mouthAmplitude = 0,
  reactionTrigger = 0,
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
    blinkUntil: number;
    nextBlinkAt: number;
    mouthAmp: number;
    /** Active reaction expression name + its end time. */
    reaction: { name: string; until: number } | null;
  }>({ blinkUntil: 0, nextBlinkAt: 0, mouthAmp: 0, reaction: null });
  const [state, setState] = useState<LoadState>("loading");

  // Update mouth-amplitude ref so the rAF loop reads the freshest value
  // without retriggering the effect.
  useEffect(() => {
    stateRef.current.mouthAmp = mouthAmplitude;
  }, [mouthAmplitude]);

  // Trigger a random reaction expression when the parent bumps reactionTrigger.
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

    // Soft sakura-ish key light + neutral fill.
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
    stateRef.current.nextBlinkAt = performance.now() + 2500 + Math.random() * 2500;

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

          // Optimisation passes recommended by @pixiv/three-vrm docs.
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
          });

          // Step 1: rotate VRM 0.x (no-op on 1.0).
          VRMUtils.rotateVRM0(vrm);
          vrm.scene.updateMatrixWorld(true);

          // Step 2: detect actual facing using head bone forward vector.
          // Some VRoid exports (incl. our bundled Shino) are marked 1.0 but
          // still face -Z. We sample the head's world-space forward and flip
          // the whole scene if it points backwards.
          const head = vrm.humanoid?.getRawBoneNode("head");
          const charForward = new THREE.Vector3(0, 0, 1);
          if (head) {
            const headQuat = head.getWorldQuaternion(new THREE.Quaternion());
            charForward.applyQuaternion(headQuat).normalize();
            if (charForward.z < 0) {
              vrm.scene.rotation.y += Math.PI;
              vrm.scene.updateMatrixWorld(true);
              charForward.negate();
            }
          }

          scene.add(vrm.scene);
          stateRef.current.vrm = vrm;

          // Step 3: compute upper-body frame (head + chest) using bones.
          const chest =
            vrm.humanoid?.getRawBoneNode("chest") ||
            vrm.humanoid?.getRawBoneNode("upperChest") ||
            vrm.humanoid?.getRawBoneNode("spine");

          // Defaults — overridden if we have bones.
          let frameTopY = 1.6;
          let frameBottomY = 1.2;
          let frameCenterX = 0;
          let frameCenterY = 1.4;
          let frameCenterZ = 0;
          let frameWidth = 0.4;

          // Use the whole-model bbox to gauge head/hair width (for horizontal fit).
          const fullBox = new THREE.Box3().setFromObject(vrm.scene);
          const fullSize = fullBox.getSize(new THREE.Vector3());
          frameWidth = fullSize.x;

          if (head) {
            const hp = head.getWorldPosition(new THREE.Vector3());
            frameCenterX = hp.x;
            frameCenterZ = hp.z;
            frameTopY = hp.y + 0.22; // headroom above hair
            if (chest) {
              const cp = chest.getWorldPosition(new THREE.Vector3());
              frameBottomY = cp.y - 0.1; // include shoulders + a hair below
            } else {
              frameBottomY = hp.y - 0.4;
            }
          } else {
            const center = fullBox.getCenter(new THREE.Vector3());
            frameCenterX = center.x;
            frameCenterZ = center.z;
            frameTopY = fullBox.max.y + 0.05;
            frameBottomY = center.y + fullSize.y * 0.05;
          }

          const frameHeight = Math.max(0.001, frameTopY - frameBottomY);
          frameCenterY = (frameTopY + frameBottomY) / 2;

          // Step 4: compute camera distance so BOTH height and width fit.
          // 30% vertical padding, 20% horizontal — comfortably uncropped.
          const fovRad = (camera.fov * Math.PI) / 180;
          const distanceH = (frameHeight / 2 / Math.tan(fovRad / 2)) * 1.3;
          const distanceW = (frameWidth / 2 / Math.tan(fovRad / 2)) * 1.2;
          const distance = Math.max(distanceH, distanceW);

          // Step 5: place camera along the character's actual forward vector
          // (works whether character was originally facing +Z or -Z).
          camera.position.set(
            frameCenterX + charForward.x * distance,
            frameCenterY,
            frameCenterZ + charForward.z * distance,
          );
          camera.lookAt(frameCenterX, frameCenterY, frameCenterZ);

          // Eye-tracking target sits 1m in front of the character along the
          // same forward direction, slightly above eye level for natural feel.
          lookTarget.position.set(
            frameCenterX + charForward.x,
            frameCenterY + 0.1,
            frameCenterZ + charForward.z,
          );

          // Wire VRM look-at to our movable target.
          if (vrm.lookAt) {
            vrm.lookAt.target = lookTarget;
          }

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
      // Normalise cursor to camera local space ~ NDC. Then push out as a world point.
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
      lookTarget.position.copy(v);
    };
    // Use window-wide tracking — the character looks even when mouse is outside the canvas.
    window.addEventListener("mousemove", onMouseMove);

    const tick = () => {
      if (disposed) return;
      const t = performance.now();
      const dt = clock.getDelta();
      const vrm = stateRef.current.vrm;

      if (vrm) {
        vrm.update(dt);

        // ---- Procedural blink ----
        const blink = vrm.expressionManager;
        if (blink) {
          if (t < stateRef.current.blinkUntil) {
            blink.setValue("blink", 1);
          } else {
            blink.setValue("blink", 0);
            if (t > stateRef.current.nextBlinkAt) {
              stateRef.current.blinkUntil = t + 130;
              stateRef.current.nextBlinkAt = t + 2800 + Math.random() * 2800;
            }
          }

          // ---- Mouth (lip-sync) ----
          const amp = stateRef.current.mouthAmp;
          blink.setValue("aa", Math.max(0, Math.min(1, amp)));

          // ---- Reaction expression (decays smoothly over 1.4s) ----
          const reaction = stateRef.current.reaction;
          if (reaction) {
            if (t < reaction.until) {
              const remaining = (reaction.until - t) / 1400;
              const eased = Math.sin(remaining * Math.PI); // 0 → 1 → 0
              try {
                blink.setValue(reaction.name, eased);
              } catch {
                /* expression name not in model */
              }
            } else {
              try {
                blink.setValue(reaction.name, 0);
              } catch {
                /* ignore */
              }
              stateRef.current.reaction = null;
            }
          }
        }

        // ---- Subtle breathing — bob the whole rig a hair ----
        const phase = t / 1000;
        vrm.scene.position.y = Math.sin(phase * 1.6) * 0.004;
        vrm.scene.rotation.y = Math.sin(phase * 0.5) * 0.04;
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
        // Click-through stays via App.tsx CSS unless onClick is supplied
        pointerEvents: onClick ? "auto" : "none",
      }}
    />
  );
}
