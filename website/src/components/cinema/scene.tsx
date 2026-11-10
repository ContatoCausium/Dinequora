import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "../ui";

/**
 * Scroll-driven film scenes.
 *
 * A scene is a tall section with a sticky, full-screen stage. Scrolling through the
 * section moves a progress value from 0 to 1; the stage draws the matching frame of a
 * pre-sliced video on a canvas (the "Apple product page" technique) and overlays read
 * the same progress to time their text, charts and UI.
 */

export type FrameSet = {
  /** Folder under /public, e.g. "/frames/abertura". Holds d/001.webp… and m/001.webp… */
  dir: string;
  total: number;
};

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 0 → 1 progress of a tall element whose stage is sticky: 0 when its top hits the viewport top, 1 when its bottom reaches the viewport bottom. */
function progressOf(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const travel = el.offsetHeight - window.innerHeight;
  // Not laid out yet (or shorter than the screen): treat as the start of the scene.
  if (travel <= 0) return 0;
  return Math.min(1, Math.max(0, -rect.top / travel));
}

/** Progress (0..1) of a tall section, updated on animation frames while it is near the viewport. */
export function useSectionProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const p = progressOf(el);
      if (Math.abs(p - last) > 0.0015 || (p !== last && (p === 0 || p === 1))) {
        last = p;
        setProgress(p);
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return { ref, progress };
}

/** Maps progress inside [from, to] to 0..1 (clamped). */
export function segment(p: number, from: number, to: number) {
  if (to <= from) return p >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (p - from) / (to - from)));
}

/** Canvas that draws the frame matching `progress`, loading frames progressively once the scene is near. */
function FrameCanvas({ frames, progress, className }: { frames: FrameSet; progress: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const images = useRef<Array<HTMLImageElement | undefined>>([]);
  const drawn = useRef(-1);
  const current = useRef(0);
  const target = useRef(0);
  const raf = useRef(0);
  const [near, setNear] = useState(false);

  // Start loading when the scene is within ~1.5 screens.
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext?.("2d");
    if (!el || !ctx) return;

    const variant = window.matchMedia("(max-width: 760px)").matches ? "m" : "d";
    const src = (i: number) => `${frames.dir}/${variant}/${String(i + 1).padStart(3, "0")}.webp`;
    const ready = (i: number) => {
      const img = images.current[i];
      return !!img && img.complete && img.naturalWidth > 0;
    };
    const nearestReady = (i: number) => {
      for (let d = 0; d < frames.total; d++) {
        if (i - d >= 0 && ready(i - d)) return i - d;
        if (i + d < frames.total && ready(i + d)) return i + d;
      }
      return -1;
    };
    const draw = (i: number, force = false) => {
      const j = nearestReady(i);
      if (j < 0 || (j === drawn.current && !force)) return;
      const img = images.current[j]!;
      const cw = el.width;
      const ch = el.height;
      const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      drawn.current = j;
    };
    const load = (i: number) => {
      if (images.current[i]) return;
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (drawn.current === -1 || Math.round(current.current) === i) draw(Math.round(current.current), true);
      };
      img.src = src(i);
      images.current[i] = img;
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
      draw(Math.round(current.current), true);
    };

    load(0);
    let timer = 0;
    if (near) {
      // Coarse-to-fine passes so the whole film is roughly available early.
      const queue: number[] = [];
      const seen = new Set<number>();
      for (const step of [8, 4, 2, 1])
        for (let i = 0; i < frames.total; i += step)
          if (!seen.has(i)) {
            seen.add(i);
            queue.push(i);
          }
      let k = 0;
      const batch = () => {
        for (let n = 0; n < 6 && k < queue.length; n++) load(queue[k++]!);
        if (k < queue.length) timer = window.setTimeout(batch, 35);
      };
      batch();
    }

    // Ease toward the scroll target: feels like film, not a slideshow.
    const smooth = !reducedMotion();
    const loop = () => {
      const diff = target.current - current.current;
      current.current = smooth && Math.abs(diff) > 0.04 ? current.current + diff * 0.2 : target.current;
      draw(Math.round(current.current));
      raf.current = requestAnimationFrame(loop);
    };
    resize();
    raf.current = requestAnimationFrame(loop);
    window.addEventListener("resize", resize);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
    };
  }, [frames, near]);

  useEffect(() => {
    target.current = progress * (frames.total - 1);
  }, [progress, frames.total]);

  return <canvas ref={canvas} aria-hidden className={cx("absolute inset-0 h-full w-full", className)} />;
}

/**
 * A full-screen film scene. `height` is the scroll length in viewport heights.
 * Children receive the scene progress (0..1).
 */
export function FilmScene({
  id,
  frames,
  poster,
  height,
  label,
  className,
  children,
}: {
  id?: string;
  frames: FrameSet;
  /** First frame, shown before the canvas paints and as the reduced-data fallback. */
  poster: string;
  height: number;
  label?: string;
  className?: string;
  children: (progress: number) => ReactNode;
}) {
  const { ref, progress } = useSectionProgress<HTMLElement>();
  return (
    <section
      ref={ref}
      id={id}
      aria-label={label}
      className={cx("relative", className)}
      style={{ height: `${height}svh` } as CSSProperties}
    >
      <div className="sticky top-0 h-svh overflow-hidden bg-navy-950">
        <img src={poster} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        <FrameCanvas frames={frames} progress={progress} />
        {children(progress)}
      </div>
    </section>
  );
}

/** Text or UI that is visible while progress is inside [from, to]; fades and lifts in and out. */
export function Moment({
  p,
  from,
  to,
  className,
  children,
}: {
  p: number;
  from: number;
  to: number;
  className?: string;
  children: ReactNode;
}) {
  const active = p >= from && (p < to || (to >= 1 && p >= 1));
  return (
    <div
      aria-hidden={!active}
      inert={!active}
      className={cx(
        "moment transition-[opacity,transform,filter] duration-[900ms] ease-out-quint",
        active ? "translate-y-0 opacity-100 blur-0" : "pointer-events-none translate-y-6 opacity-0 blur-[6px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
