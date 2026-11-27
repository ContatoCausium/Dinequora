import { createContext, useContext } from "react";

/**
 * Focus mode for operational screens (POS, kitchen display): the app chrome (sidebar, header,
 * bottom navigation) steps aside so the whole screen serves the counter or the line. Where the
 * browser allows it, the page also goes full screen. Presentation only — nothing is stored.
 */
export interface FocusMode {
  /** Whether the current screen supports focus mode. */
  available: boolean;
  active: boolean;
  toggle: () => void;
  exit: () => void;
}

const NOOP: FocusMode = { available: false, active: false, toggle: () => {}, exit: () => {} };

export const FocusModeContext = createContext<FocusMode>(NOOP);

export const useFocusMode = () => useContext(FocusModeContext);

/** Routes whose screen is operated by touch, at the counter or on the line. */
export const OPERATIONAL_ROUTES = ["/pos", "/kds"] as const;

export const isOperationalRoute = (path: string) =>
  OPERATIONAL_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));

/** Best effort: full screen is optional (iOS Safari and embedded browsers refuse it). */
export async function enterFullscreen() {
  try {
    if (typeof document !== "undefined" && !document.fullscreenElement)
      await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
  } catch {
    // Focus mode still hides the app chrome without the browser's full screen.
  }
}

export async function exitFullscreen() {
  try {
    if (typeof document !== "undefined" && document.fullscreenElement)
      await document.exitFullscreen();
  } catch {
    // Nothing to undo.
  }
}
