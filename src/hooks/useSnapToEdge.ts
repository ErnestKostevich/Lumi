import { useEffect } from "react";
import { getCurrentWindow, currentMonitor, PhysicalPosition } from "@tauri-apps/api/window";

const SNAP_DISTANCE_PX = 36;

/**
 * Snap Lumi window to monitor edges when dragged near them.
 * Runs a low-frequency poll (every 200ms) checking window position; when
 * position changes (i.e. user is dragging or just released), checks distance
 * to each edge and snaps if within SNAP_DISTANCE_PX.
 *
 * Why polling and not 'tauri://move' event: drag-region drag doesn't always
 * fire move events reliably across platforms; polling is dumb but works.
 */
export function useSnapToEdge() {
  useEffect(() => {
    let cancelled = false;
    let lastX = -99999;
    let lastY = -99999;

    const check = async () => {
      try {
        const win = getCurrentWindow();
        const [pos, size, monitor] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          currentMonitor(),
        ]);
        if (!monitor) return;

        // Only snap if position has just changed (user finished dragging).
        const moved = pos.x !== lastX || pos.y !== lastY;
        if (!moved) return;
        lastX = pos.x;
        lastY = pos.y;

        const mx = monitor.position.x;
        const my = monitor.position.y;
        const mw = monitor.size.width;
        const mh = monitor.size.height;

        let snapX = pos.x;
        let snapY = pos.y;
        let didSnap = false;

        // Left edge
        if (Math.abs(pos.x - mx) < SNAP_DISTANCE_PX) {
          snapX = mx;
          didSnap = true;
        }
        // Right edge
        const rightEdge = mx + mw - size.width;
        if (Math.abs(pos.x - rightEdge) < SNAP_DISTANCE_PX) {
          snapX = rightEdge;
          didSnap = true;
        }
        // Top edge
        if (Math.abs(pos.y - my) < SNAP_DISTANCE_PX) {
          snapY = my;
          didSnap = true;
        }
        // Bottom edge
        const bottomEdge = my + mh - size.height;
        if (Math.abs(pos.y - bottomEdge) < SNAP_DISTANCE_PX) {
          snapY = bottomEdge;
          didSnap = true;
        }

        if (didSnap && !cancelled) {
          await win.setPosition(new PhysicalPosition(snapX, snapY));
          lastX = snapX;
          lastY = snapY;
        }
      } catch {
        // Tauri API not available (web preview, etc.) — silently skip.
      }
    };

    const id = window.setInterval(check, 200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
}
