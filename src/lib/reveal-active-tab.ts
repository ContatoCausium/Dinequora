/**
 * Keeps the active item of a horizontally scrolling tab bar in view (centered when possible).
 * Scrolls only the bar itself — never the page — and only when the bar actually overflows, so a
 * vertical sidebar (wide screens) is left alone. Smooth unless the user prefers reduced motion.
 */
export function revealActiveTab(
  bar: HTMLElement,
  selector = '[data-status="active"], [aria-current="page"]',
): number | null {
  if (bar.scrollWidth <= bar.clientWidth + 1) return null;
  const active = bar.querySelector<HTMLElement>(selector);
  if (!active) return null;
  const barRect = bar.getBoundingClientRect();
  const itemRect = active.getBoundingClientRect();
  const itemLeft = itemRect.left - barRect.left + bar.scrollLeft;
  const max = bar.scrollWidth - bar.clientWidth;
  const target = Math.max(0, Math.min(max, itemLeft - (bar.clientWidth - itemRect.width) / 2));
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof bar.scrollTo === "function")
    bar.scrollTo({ left: target, behavior: reduce ? "auto" : "smooth" });
  else bar.scrollLeft = target;
  return target;
}
