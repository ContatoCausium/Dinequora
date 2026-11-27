import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n";
import { kpiDelta, previousWindow, relativeChange } from "@/lib/period-compare";
import { periodStart } from "@/lib/recorded-data";
import { StatTile } from "@/components/app/stat-tile";
import { ColumnSeries } from "@/components/app/charts";

/** Redesign phase 4: comparisons are read-only and never invent a trend from missing data. */
afterEach(cleanup);

const NOW = new Date(2026, 10, 16, 14, 30); // local time, Nov 16 2026 14:30

describe("previousWindow", () => {
  it("7/30/90 days: the same number of whole days right before the current window", () => {
    for (const p of ["7d", "30d", "90d"] as const) {
      const w = previousWindow(p, NOW);
      const days = Number(p.replace("d", ""));
      expect(w.end).toBe(periodStart(p, NOW));
      expect(w.days).toBe(days);
      const start = new Date(w.since);
      const end = new Date(w.end);
      expect(start.getHours()).toBe(0);
      // whole local days (robust to DST): calendar distance in days
      const cal = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
      expect((cal(end) - cal(start)) / 86_400_000).toBe(days);
      expect(w.now.getTime()).toBe(end.getTime() - 1);
    }
  });
  it("today compares with yesterday up to the same time of day", () => {
    const w = previousWindow("today", NOW);
    expect(new Date(w.since)).toEqual(new Date(2026, 10, 15, 0, 0));
    expect(new Date(w.end)).toEqual(new Date(2026, 10, 15, 14, 30));
    expect(w.days).toBe(1);
  });
});

describe("relativeChange / kpiDelta", () => {
  it("no previous value means no comparison (never +∞ or +100%)", () => {
    expect(relativeChange(500, 0)).toBeNull();
    expect(kpiDelta(500, 0, { lng: "en-US", caption: "c", unavailable: "No comparison" })).toEqual({
      direction: null,
      text: "No comparison",
      tone: "neutral",
      caption: "c",
    });
    expect(kpiDelta(500, undefined, { lng: "en-US", caption: "c", unavailable: "n/a" }).text).toBe(
      "n/a",
    );
  });
  it("signed percent, direction and tone", () => {
    const up = kpiDelta(1124, 1000, { lng: "en-US", caption: "c", unavailable: "-" });
    expect(up).toMatchObject({ direction: "up", text: "+12.4%", tone: "positive" });
    const down = kpiDelta(900, 1000, { lng: "en-US", caption: "c", unavailable: "-" });
    expect(down).toMatchObject({ direction: "down", tone: "negative" });
    expect(down.text).toMatch(/^[-−]10%$/);
    const flat = kpiDelta(1003, 1000, { lng: "en-US", caption: "c", unavailable: "-" });
    expect(flat).toMatchObject({ direction: "flat", text: "0%", tone: "neutral" });
    const cost = kpiDelta(1200, 1000, {
      lng: "en-US",
      caption: "c",
      unavailable: "-",
      goodWhen: "none",
    });
    expect(cost).toMatchObject({ direction: "up", tone: "neutral" });
  });
});

describe("StatTile delta", () => {
  it("shows icon + signed text + caption (not color alone)", () => {
    render(
      <StatTile
        label="Net sales"
        value="$4,997.22"
        delta={kpiDelta(1124, 1000, {
          lng: "en-US",
          caption: "vs previous 7 days",
          unavailable: "-",
        })}
        trend={[1, 3, 2]}
      />,
    );
    const pct = screen.getByText("+12.4%");
    expect(pct.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("vs previous 7 days")).toBeInTheDocument();
  });
});

describe("ColumnSeries", () => {
  const points = [
    { key: "a", label: "Nov 14", value: 12_000 },
    { key: "b", label: "Nov 15", value: 0 },
    { key: "c", label: "Nov 16", value: 23_000 },
  ];
  it("rounds the axis up and lists both periods in the accessible table", () => {
    const { container } = render(
      <ColumnSeries
        caption="Net sales by day"
        format={(c) => `$${(c / 100).toFixed(2)}`}
        formatAxis={(c) => `$${c / 100}`}
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
    // 23,000 cents → 25,000 nice max (twice: the label and the invisible copy that sizes the column)
    expect(screen.getAllByText("$250").length).toBe(2);
    expect(screen.getByText("$125")).toBeInTheDocument();
    const table = container.querySelector("table")!;
    expect(table.textContent).toContain("Nov 15$0.00Nov 8: $50.00");
    // hover shows both values
    fireEvent.mouseEnter(
      screen.getAllByText("Nov 14")[0]!.closest("figure")!.querySelector(".flex-1 .flex > div")!,
    );
    expect(screen.getAllByText("$120.00").length).toBeGreaterThan(1);
  });
  it("ignores a previous series that does not line up day by day", () => {
    render(
      <ColumnSeries
        caption="x"
        format={String}
        points={points}
        previous={{
          values: [1],
          labels: ["x"],
          currentLabel: "This period",
          previousLabel: "Previous period",
          tableLabel: "Previous period",
        }}
      />,
    );
    expect(screen.queryByText("Previous period")).toBeNull();
  });
});
