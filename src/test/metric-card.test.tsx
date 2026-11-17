import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { MetricCard } from "@/components/app/metric-card";
import { ColumnSeries } from "@/components/app/charts";
import { StatTile } from "@/components/app/stat-tile";
import { kpiDelta } from "@/lib/period-compare";
import { completedDayStats } from "@/lib/series-stats";

/** Redesign stage A: the Overview hero card (MetricCard) and the figures in its footer. */
afterEach(cleanup);

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const opts = { lng: "en-US", caption: "vs previous 7 days", unavailable: "No comparison" };

describe("completedDayStats", () => {
  const daily = [
    { day: "2026-11-11", cents: 68_174 },
    { day: "2026-11-12", cents: 57_475 },
    { day: "2026-11-13", cents: 79_000 },
    { day: "2026-11-14", cents: 96_665 },
    { day: "2026-11-15", cents: 65_998 },
    { day: "2026-11-16", cents: 77_190 },
    { day: "2026-11-17", cents: 0 }, // today, still open
  ];
  it("ignores the day in progress (it would always look like the weakest day)", () => {
    const s = completedDayStats(daily, "2026-11-17")!;
    expect(s.days).toBe(6);
    expect(s.highest).toEqual({ day: "2026-11-14", cents: 96_665 });
    expect(s.lowest).toEqual({ day: "2026-11-12", cents: 57_475 });
    // (68174 + 57475 + 79000 + 96665 + 65998 + 77190) / 6 = 74083.67 → rounded to whole cents
    expect(s.averageCents).toBe(74_084);
  });
  it("keeps real zero days and the earliest day on ties", () => {
    const s = completedDayStats(
      [
        { day: "2026-11-01", cents: 500 },
        { day: "2026-11-02", cents: 0 },
        { day: "2026-11-03", cents: 500 },
        { day: "2026-11-04", cents: 0 },
      ],
      "2026-11-05",
    )!;
    expect(s.highest.day).toBe("2026-11-01");
    expect(s.lowest).toEqual({ day: "2026-11-02", cents: 0 });
    expect(s.averageCents).toBe(250);
  });
  it("returns null when no completed day is in the window", () => {
    expect(completedDayStats([{ day: "2026-11-17", cents: 900 }], "2026-11-17")).toBeNull();
    expect(completedDayStats([], "2026-11-17")).toBeNull();
  });
});

describe("MetricCard", () => {
  const stats = [
    { key: "highest", label: "Highest day", value: "$966.65", detail: "Nov 14" },
    { key: "lowest", label: "Lowest day", value: "$574.75", detail: "Nov 12" },
    { key: "average", label: "Daily average", value: "$742.91", detail: "6 days" },
  ];
  it("is a labelled region with the figure, the comparison (icon + text) and the stats list", () => {
    const { container } = render(
      <MetricCard
        label="Net sales"
        value="$4,457.47"
        delta={kpiDelta(1067, 1000, opts)}
        hint="Net of tax and reversals"
        stats={stats}
        statsNote="Completed days only — today is still in progress."
      >
        <p>chart</p>
      </MetricCard>,
    );
    const region = screen.getByRole("region", { name: "Net sales" });
    expect(within(region).getByRole("heading", { name: "Net sales" })).toBeInTheDocument();
    expect(within(region).getByText("$4,457.47")).toBeInTheDocument();
    const pct = within(region).getByText("+6.7%");
    expect(pct.querySelector("svg")).not.toBeNull(); // never color alone
    expect(pct.className).toContain("text-success");
    expect(within(region).getByText("vs previous 7 days")).toBeInTheDocument();
    // max / min / average as a description list (term → value → day)
    const terms = [...container.querySelectorAll("dt")].map((d) => d.textContent);
    expect(terms).toEqual(["Highest day", "Lowest day", "Daily average"]);
    expect([...container.querySelectorAll("dd")].map((d) => d.textContent)).toEqual([
      "$966.65",
      "Nov 14",
      "$574.75",
      "Nov 12",
      "$742.91",
      "6 days",
    ]);
    expect(screen.getByText(/Completed days only/)).toBeInTheDocument();
    // the decorative backdrop is hidden from assistive technology
    expect(screen.getByTestId("metric-backdrop")).toHaveAttribute("aria-hidden", "true");
  });
  it("colors the comparison by meaning (kpiDelta), not by direction", () => {
    render(<MetricCard label="Net sales" value="$1" delta={kpiDelta(900, 1000, opts)} />);
    expect(screen.getByText(/^[-−]10%$/).className).toContain("text-destructive");
    cleanup();
    render(
      <MetricCard
        label="COGS"
        value="$1"
        delta={kpiDelta(1200, 1000, { ...opts, goodWhen: "none" })}
      />,
    );
    const up = screen.getByText("+20%");
    expect(up.className).toContain("text-foreground");
    expect(up.className).not.toContain("text-success");
  });
  it("omits the chart area and the footer when there is nothing to show", () => {
    const { container } = render(<MetricCard label="Net sales" value="$0.00" stats={[]} />);
    expect(screen.queryByTestId("metric-backdrop")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
  });
  it("uses only design tokens (white-label and dark mode follow; no fixed colors)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "components", "app", "metric-card.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(src).not.toMatch(/\b(rgb|hsl|oklch)\(/i);
    const css = fs.readFileSync(path.resolve(__dirname, "..", "styles.css"), "utf8");
    const backdrop = css.slice(css.indexOf("@utility metric-backdrop"));
    const block = backdrop.slice(0, backdrop.indexOf("\n}\n"));
    expect(block).toContain("var(--color-chart-1)");
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("hero chart (ColumnSeries inside the card)", () => {
  const points = [
    { key: "a", label: "Nov 14", value: 12_000 },
    { key: "b", label: "Nov 15", value: 8_000 },
    { key: "c", label: "Nov 16", value: 23_000 },
  ];
  it("columns rise only when asked; keyboard, live region and table are unchanged", () => {
    const { container } = render(
      <MetricCard label="Net sales" value="$430.00">
        <ColumnSeries animate caption="Net sales by day" format={money} points={points} />
      </MetricCard>,
    );
    const bars = container.querySelectorAll(".bg-chart-1.animate-grow");
    expect(bars).toHaveLength(3);
    const group = screen.getByRole("group", { name: /Net sales by day\. Use the left and right/ });
    const live = group.parentElement!.querySelector("[aria-live]")!;
    fireEvent.focus(group);
    expect(live.textContent).toBe("Nov 16: $230.00");
    fireEvent.keyDown(group, { key: "Home" });
    expect(live.textContent).toBe("Nov 14: $120.00");
    expect(container.querySelector("table caption")?.textContent).toBe("Net sales by day");
    cleanup();
    const plain = render(<ColumnSeries caption="x" format={money} points={points} />);
    expect(plain.container.querySelector(".animate-grow")).toBeNull();
  });
});

describe("StatTile API is unchanged", () => {
  it("still renders label, value, delta, hint and the decorative sparkline", () => {
    const { container } = render(
      <StatTile
        label="Orders"
        value="133"
        delta={kpiDelta(133, 128, opts)}
        hint="Avg. ticket $33.51"
        tone="positive"
        trend={[1, 3, 2]}
      />,
    );
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.getByText("+3.9%")).toBeInTheDocument();
    expect(screen.getByText("Avg. ticket $33.51")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden] svg polyline")).not.toBeNull();
  });
});

describe("hero copy", () => {
  it("exists in both languages with plural forms", () => {
    for (const lng of ["en-US", "pt-BR"]) {
      const t = i18n.getFixedT(lng, "dashboard");
      for (const k of ["highest", "lowest", "average", "statsNote", "todayNote"])
        expect(t(`home.hero.${k}`)).not.toBe(`home.hero.${k}`);
      expect(t("home.hero.days", { count: 1 })).toMatch(/^1 (day|dia)$/);
      expect(t("home.hero.days", { count: 6 })).toMatch(/^6 (days|dias)$/);
    }
  });
});
