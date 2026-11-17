import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n";
import { ColumnSeries } from "@/components/app/charts";
import { btnGhost, btnPrimary, inputCls } from "@/components/control/control-styles";
import { buttonVariants } from "@/components/ui/button";

/** Redesign phase 6: accessibility of charts and consistency policies across the product. */
afterEach(cleanup);

describe("column chart keyboard access", () => {
  const points = [
    { key: "a", label: "Nov 14", value: 12_000 },
    { key: "b", label: "Nov 15", value: 8_000 },
    { key: "c", label: "Nov 16", value: 23_000 },
  ];
  it("is one focusable group; arrows move between days and the value is announced", () => {
    render(
      <ColumnSeries
        caption="Net sales by day"
        format={(c) => `$${(c / 100).toFixed(2)}`}
        points={points}
        previous={{
          values: [10_000, 5_000, 20_000],
          labels: ["Nov 7", "Nov 8", "Nov 9"],
          currentLabel: "This period",
          previousLabel: "Previous period",
          tableLabel: "Previous period",
        }}
      />,
    );
    const group = screen.getByRole("group", {
      name: /Net sales by day\. Use the left and right arrow keys/,
    });
    expect(group).toHaveAttribute("tabindex", "0");
    const live = group.parentElement!.querySelector("[aria-live]")!;
    fireEvent.focus(group);
    expect(live.textContent).toBe("Nov 16: $230.00. Previous period, Nov 9: $200.00");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(live.textContent).toContain("Nov 15: $80.00");
    fireEvent.keyDown(group, { key: "Home" });
    expect(live.textContent).toContain("Nov 14: $120.00");
    fireEvent.keyDown(group, { key: "ArrowLeft" }); // stays on the first day
    expect(live.textContent).toContain("Nov 14");
    fireEvent.keyDown(group, { key: "End" });
    expect(live.textContent).toContain("Nov 16");
    fireEvent.blur(group);
    expect(live.textContent).toBe("");
  });
});

describe("Control Center uses the kit's controls", () => {
  it("buttons are the kit's variants and fields share the kit's focus treatment", () => {
    expect(btnPrimary).toBe(buttonVariants({ variant: "default" }));
    expect(btnGhost).toBe(buttonVariants({ variant: "ghost" }));
    expect(inputCls).toContain("focus-visible:focus-field");
    expect(inputCls).toContain("border-input");
  });
});

describe("consistency policies", () => {
  const root = path.resolve(__dirname, "..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!["test", "ui"].includes(e.name)) walk(p);
      } else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(path.join(root, "routes"));
  walk(path.join(root, "components"));
  const offenders = (re: RegExp) =>
    files.filter((f) => re.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f));

  it("no raw palette colors outside the design tokens", () => {
    expect(
      offenders(
        /\b(?:bg|text|border|ring|fill|stroke)-(?:red|amber|emerald|green|yellow|orange|blue|sky|slate|gray|zinc|rose|indigo|violet|purple|pink|teal|cyan|lime)-\d{2,3}\b/,
      ),
    ).toEqual([]);
  });
  it("no native checkboxes or radio buttons (kit Checkbox / RadioGroup instead)", () => {
    expect(offenders(/type="(?:checkbox|radio)"/)).toEqual([]);
  });
  it("route files only declare routes, so every page can be code-split", () => {
    const routeDir = path.join(root, "routes", "_authenticated", "_app");
    for (const f of ["index", "finance", "intelligence", "inventory", "kds", "locations", "pos"]) {
      const src = fs.readFileSync(path.join(routeDir, `${f}.tsx`), "utf8");
      expect(src.match(/^export /gm), f).toHaveLength(1);
    }
  });
});
