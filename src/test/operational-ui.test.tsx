import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n";
import { FocusModeContext, isOperationalRoute, type FocusMode } from "@/lib/focus-mode";
import { FocusModeButton } from "@/components/app/focus-mode-button";
import { CATEGORY_COLORS, categoryColorMap, initials } from "@/lib/category-colors";

/** Redesign phase 5: operational screens (POS, kitchen) and shared category identity. */
afterEach(cleanup);

describe("focus mode", () => {
  it("is offered only on the POS and the kitchen display", () => {
    expect(isOperationalRoute("/pos")).toBe(true);
    expect(isOperationalRoute("/kds")).toBe(true);
    expect(isOperationalRoute("/")).toBe(false);
    expect(isOperationalRoute("/orders")).toBe(false);
    expect(isOperationalRoute("/position")).toBe(false);
  });

  it("the button reflects and toggles the state", () => {
    const toggle = vi.fn();
    const value: FocusMode = { available: true, active: false, toggle, exit: vi.fn() };
    const { rerender } = render(
      <FocusModeContext.Provider value={value}>
        <FocusModeButton />
      </FocusModeContext.Provider>,
    );
    const button = screen.getByRole("button", { name: "Full screen" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    rerender(
      <FocusModeContext.Provider value={{ ...value, active: true }}>
        <FocusModeButton />
      </FocusModeContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Exit full screen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders nothing where focus mode is not available", () => {
    const { container } = render(<FocusModeButton />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("category colors", () => {
  const cats = [
    { id: "c-sides", name: "Sides" },
    { id: "c-burgers", name: "Burgers" },
    { id: "c-drinks", name: "Drinks" },
  ];
  it("are the same whatever the order the categories arrive in (POS and Menu agree)", () => {
    const a = categoryColorMap(cats, "en-US");
    const b = categoryColorMap([...cats].reverse(), "en-US");
    for (const c of cats) expect(a.get(c.id)).toBe(b.get(c.id));
    expect(a.get("c-burgers")).toBe(CATEGORY_COLORS[0]);
  });
  it("come from the validated series palette only", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}` }));
    for (const color of categoryColorMap(many, "en-US").values())
      expect(CATEGORY_COLORS).toContain(color);
  });
  it("initials fall back for products without a photo", () => {
    expect(initials("Classic Burger")).toBe("CB");
    expect(initials("cheeseburger")).toBe("C");
    expect(initials("  Fresh   Lemonade  Large ")).toBe("FL");
  });
});
