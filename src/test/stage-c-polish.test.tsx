import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Segmented } from "@/components/app/page";

/** Redesign stage C: finishing fixes that are not covered by a page-level test. */
afterEach(cleanup);

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, "..", ...p), "utf8");

describe("Segmented", () => {
  const options = [
    { value: "financial", label: "Financial summary" },
    { value: "food", label: "Food cost" },
    { value: "low", label: "Low stock" },
  ];
  it("keeps its compact inline look by default (every existing use is unchanged)", () => {
    render(<Segmented label="Period" value="food" onChange={() => {}} options={options} />);
    const group = screen.getByRole("radiogroup", { name: "Period" });
    expect(group.className).toContain("inline-flex");
    expect(group.className).not.toContain("w-full");
    for (const r of screen.getAllByRole("radio")) expect(r.className).not.toContain("truncate");
  });
  it("fill: full width, labels never wrap or spill (narrow panels such as the WhatsApp preview)", () => {
    const onChange = vi.fn();
    render(<Segmented fill label="Template" value="food" onChange={onChange} options={options} />);
    const group = screen.getByRole("radiogroup", { name: "Template" });
    expect(group.className).toContain("w-full");
    const first = screen.getByRole("radio", { name: "Financial summary" });
    expect(first.className).toContain("whitespace-nowrap");
    expect(first.className).toContain("truncate");
    expect(first).toHaveAttribute("title", "Financial summary"); // full label even if truncated
    expect(screen.getByRole("radio", { name: "Food cost" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(first);
    expect(onChange).toHaveBeenCalledWith("financial");
  });
});

describe("focus and toasts stay clear of the sticky header and the phone/tablet bar (WCAG 2.4.11)", () => {
  const css = read("styles.css");
  it("reserves scroll space above focused elements (sticky header) and below them on < 1024 px", () => {
    expect(css).toMatch(/html\s*{[^}]*scroll-padding-top:\s*4\.5rem/);
    const mobile = css.slice(css.indexOf("@media (max-width: 1023px)"));
    expect(mobile).toMatch(
      /scroll-padding-bottom:\s*calc\(5rem \+ env\(safe-area-inset-bottom\)\)/,
    );
    expect(mobile).toMatch(/\[data-sonner-toaster\]\[data-y-position="bottom"\]/);
    expect(mobile).toMatch(/--offset-bottom:\s*calc\(5rem/);
    expect(mobile).toMatch(/--mobile-offset-bottom:\s*calc\(5rem/);
  });
});

describe("consistent status semantics", () => {
  it("Insights shows low stock as a warning (amber), like the Overview, Inventory and the sidebar", () => {
    const src = read("components", "pages", "intelligence-page.tsx");
    expect(src).toContain('tone={summary.lowStockItemCount > 0 ? "warning" : "positive"}');
  });
});
