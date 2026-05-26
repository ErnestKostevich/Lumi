import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * When another app goes into true fullscreen (game, video player), minimize
 * Lumi so she doesn't break immersion. When the user returns to non-fullscreen,
 * Lumi unminimizes automatically.
 *
 * Polls every 2s — light overhead.
 */
export function useHideOnFullscreen(enabled = true) {
  const lastFullscreenRef = useRef(false);
  const hidByUsRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const check = async () => {
      try {
        const isFullscreen = await invoke<boolean>("is_foreground_fullscreen");
        if (cancelled) return;
        const win = getCurrentWindow();
        if (isFullscreen && !lastFullscreenRef.current) {
          // Just entered fullscreen — hide Lumi.
          await win.minimize();
          hidByUsRef.current = true;
        } else if (!isFullscreen && lastFullscreenRef.current && hidByUsRef.current) {
          // Just exited fullscreen — restore Lumi.
          await win.unminimize();
          hidByUsRef.current = false;
        }
        lastFullscreenRef.current = isFullscreen;
      } catch {
        /* command unavailable on this platform */
      }
    };

    void check();
    const id = window.setInterval(check, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);
}
