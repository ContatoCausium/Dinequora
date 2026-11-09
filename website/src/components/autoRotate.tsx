import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";
import { Pause, Play } from "lucide-react";
import { useT } from "../i18n/locale";
import { cx } from "./ui";

/** Time each slide stays on screen before moving to the next one. */
export const ROTATE_MS = 6000;

/**
 * Auto-rotating tabs. Advancing is driven by the progress bar's CSS animation
 * (see `RotateProgress`), so pausing the bar pauses the timer too.
 *
 * Rotation pauses while the pointer is over the block, while it has keyboard
 * focus, while it is off screen, and when the visitor presses pause. Visitors
 * who prefer reduced motion get no automatic rotation (handled in CSS).
 */
export function useAutoRotate(count: number) {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { threshold: 0.3 });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const next = useCallback(() => setActive((a) => (a + 1) % count), [count]);

  const bind = {
    ref,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.target instanceof HTMLElement && e.target.matches(":focus-visible")) setKeyboardFocus(true);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false);
    },
  };

  return {
    active,
    select: setActive,
    next,
    running: onScreen && !hovered && !keyboardFocus && !userPaused,
    userPaused,
    togglePause: () => setUserPaused((p) => !p),
    bind,
  };
}

/** Thin bar that fills while the slide is shown; when it completes, `onDone` advances. */
export function RotateProgress({
  running,
  onDone,
  className,
}: {
  running: boolean;
  onDone: () => void;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx("rotate-progress block h-full w-full", className)}
      style={{ animationDuration: `${ROTATE_MS}ms`, animationPlayState: running ? "running" : "paused" }}
      onAnimationEnd={onDone}
    />
  );
}

export function PauseButton({ paused, onToggle, className }: { paused: boolean; onToggle: () => void; className?: string }) {
  const t = useT();
  const label = paused ? t("Resume automatic rotation", "Retomar a rotação automática") : t("Pause automatic rotation", "Pausar a rotação automática");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={cx(
        "grid size-8 shrink-0 place-items-center rounded-full text-mist ring-1 ring-inset ring-mist/20 transition-colors hover:text-offwhite hover:ring-mist/40",
        className,
      )}
    >
      {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
    </button>
  );
}
