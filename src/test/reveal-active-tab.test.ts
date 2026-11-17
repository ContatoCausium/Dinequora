import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealActiveTab } from "@/lib/reveal-active-tab";

/** Control Center phone navigation: the current section is brought into view on arrival. */
function bar({
  scrollWidth,
  clientWidth,
  itemLeft,
  itemWidth,
  scrollLeft = 0,
}: {
  scrollWidth: number;
  clientWidth: number;
  itemLeft: number;
  itemWidth: number;
  scrollLeft?: number;
}) {
  const el = document.createElement("nav");
  const item = document.createElement("a");
  item.setAttribute("data-status", "active");
  el.appendChild(item);
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { value: clientWidth });
  el.scrollLeft = scrollLeft;
  el.getBoundingClientRect = () => ({ left: 0, right: clientWidth, width: clientWidth }) as DOMRect;
  item.getBoundingClientRect = () =>
    ({ left: itemLeft, right: itemLeft + itemWidth, width: itemWidth }) as DOMRect;
  const scrollTo = vi.fn();
  el.scrollTo = scrollTo as unknown as typeof el.scrollTo;
  return { el, scrollTo };
}

afterEach(() => vi.restoreAllMocks());

describe("revealActiveTab", () => {
  it("centers an off-screen active tab inside the bar (never the page)", () => {
    const { el, scrollTo } = bar({
      scrollWidth: 1300,
      clientWidth: 390,
      itemLeft: 870,
      itemWidth: 150,
    });
    expect(revealActiveTab(el)).toBe(750); // 870 - (390 - 150) / 2
    expect(scrollTo).toHaveBeenCalledWith({ left: 750, behavior: "smooth" });
  });

  it("clamps to the ends of the bar", () => {
    const first = bar({ scrollWidth: 1300, clientWidth: 390, itemLeft: 12, itemWidth: 110 });
    expect(revealActiveTab(first.el)).toBe(0);
    const last = bar({ scrollWidth: 1300, clientWidth: 390, itemLeft: 1180, itemWidth: 110 });
    expect(revealActiveTab(last.el)).toBe(910);
  });

  it("does nothing when the bar does not overflow (vertical sidebar on wide screens)", () => {
    const { el, scrollTo } = bar({
      scrollWidth: 390,
      clientWidth: 390,
      itemLeft: 100,
      itemWidth: 100,
    });
    expect(revealActiveTab(el)).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("jumps without animation when the user prefers reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList,
    );
    const { el, scrollTo } = bar({
      scrollWidth: 1300,
      clientWidth: 390,
      itemLeft: 500,
      itemWidth: 120,
    });
    revealActiveTab(el);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});

describe("copy accuracy", () => {
  it("never claims statistical models or AI for restaurant metrics", () => {
    const root = path.resolve(__dirname, "..", "locales");
    for (const lng of ["en-US", "pt-BR"])
      for (const f of fs.readdirSync(path.join(root, lng))) {
        const text = fs.readFileSync(path.join(root, lng, f), "utf8");
        expect(text, `${lng}/${f}`).not.toMatch(
          /statistical model|modelos estatísticos|machine learning|inteligência artificial/i,
        );
      }
  });
});
