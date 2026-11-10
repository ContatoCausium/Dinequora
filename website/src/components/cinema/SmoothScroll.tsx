import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Inertial wheel scrolling for the film scenes (Lenis). Skipped for visitors who ask
 * for reduced motion and on touch devices, which already scroll with momentum.
 * In-page anchors keep working and land below the fixed header.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function" || typeof ResizeObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9, anchors: { offset: -72 } });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    document.documentElement.classList.add("lenis-on");
    if (import.meta.env.DEV) (window as unknown as { __lenis?: Lenis }).__lenis = lenis;
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      document.documentElement.classList.remove("lenis-on");
    };
  }, []);
  return null;
}
