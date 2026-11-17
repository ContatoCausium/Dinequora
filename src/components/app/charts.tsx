import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free charts following the dataviz rules in the design skill:
 * one axis, thin rounded marks, a single sequential hue (chart-1), values in text ink,
 * per-mark hover tooltip, and an accessible table fallback (sr-only).
 */

/** Ranked horizontal bars (part-to-whole / comparison). Largest first. */
export function RankedBars({
  rows,
  format,
  caption,
  empty,
}: {
  rows: { key: string; label: ReactNode; value: number; hint?: ReactNode }[];
  format: (v: number) => string;
  caption: string;
  empty: ReactNode;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max <= 0)
    return <p className="py-6 text-sm text-muted-foreground">{empty}</p>;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <figure>
      <ul className="space-y-3" aria-hidden>
        {rows.map((r) => (
          <li key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="tabular shrink-0 font-medium">
                {format(r.value)}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {Math.round((r.value / total) * 100)}%
                </span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-chart-1"
                style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
              />
            </div>
            {r.hint && <p className="mt-1 text-xs text-muted-foreground">{r.hint}</p>}
          </li>
        ))}
      </ul>
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{format(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Rounds a maximum up to 1, 2, 2.5 or 5 × 10ⁿ so the axis reads in round numbers. */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/**
 * Column chart over time: one value axis, recessive grid, optional previous-period columns in the
 * neutral comparison gray (chart-6) to the left of each current column. Hover a slot to read both
 * values; the same numbers are in an accessible table.
 */
export function ColumnSeries({
  points,
  format,
  formatAxis,
  caption,
  height = 200,
  previous,
}: {
  points: { key: string; label: string; value: number }[];
  format: (v: number) => string;
  /** Compact axis labels ("$1.2K"); defaults to `format`. */
  formatAxis?: (v: number) => string;
  caption: string;
  height?: number;
  previous?:
    | {
        values: number[];
        labels: string[];
        currentLabel: string;
        previousLabel: string;
        /** Column header for the previous values in the accessible table. */
        tableLabel: string;
      }
    | undefined;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  // Keyboard: the plot is one focusable group; arrows move between days and the tooltip (and a
  // polite announcement) follows, so the values are reachable without a mouse.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const next = (current: number) =>
      e.key === "ArrowLeft"
        ? Math.max(0, current - 1)
        : e.key === "ArrowRight"
          ? Math.min(last, current + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    const target = next(active ?? last);
    if (target === null) return;
    e.preventDefault();
    setActive(target);
  };
  const prev = previous && previous.values.length === points.length ? previous : undefined;
  const top = niceCeil(Math.max(0, ...points.map((p) => p.value), ...(prev?.values ?? [])));
  const ticks = [top, top / 2, 0];
  const step = Math.max(1, Math.ceil(points.length / 8)); // ≤ 8 axis labels
  const axis = formatAxis ?? format;
  const pct = (v: number) => `${Math.max(0, (v / top) * 100)}%`;
  const n = points.length;
  return (
    <figure>
      {prev && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-chart-1" />
            {prev.currentLabel}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-chart-6" />
            {prev.previousLabel}
          </li>
        </ul>
      )}
      <div
        className="flex gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
        tabIndex={0}
        role="group"
        aria-label={`${caption}. ${t("chart.keyboardHint")}`}
        onFocus={() => setActive((a) => a ?? points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        <div className="relative w-12 shrink-0" style={{ height }} aria-hidden>
          {ticks.map((v) => (
            <span
              key={v}
              className="tabular absolute right-0 -translate-y-1/2 whitespace-nowrap text-[11px] text-muted-foreground"
              style={{ top: `${(1 - v / top) * 100}%` }}
            >
              {axis(v)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1" aria-hidden>
          <div className="relative" style={{ height }}>
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/70" />
            <div className="absolute inset-x-0 bottom-0 border-t border-border" />
            <div className="absolute inset-0 flex items-end gap-[3px]">
              {points.map((p, i) => {
                const isActive = active === i;
                const dim = active != null && !isActive;
                const align =
                  i < n / 4 ? "left-0" : i >= (n * 3) / 4 ? "right-0" : "left-1/2 -translate-x-1/2";
                const pv = prev?.values[i];
                return (
                  <div
                    key={p.key}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    className={cn(
                      "relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-t-[4px] transition-colors",
                      isActive && "bg-muted/60",
                    )}
                  >
                    {prev && (
                      <span
                        className={cn(
                          "w-full max-w-[14px] rounded-t-[3px] bg-chart-6 transition-opacity",
                          dim && "opacity-40",
                          (pv ?? 0) > 0 && "min-h-[2px]",
                        )}
                        style={{ height: pct(pv ?? 0) }}
                      />
                    )}
                    <span
                      className={cn(
                        "w-full rounded-t-[4px] bg-chart-1 transition-opacity",
                        prev ? "max-w-[14px]" : "max-w-[32px]",
                        dim && "opacity-40",
                        p.value > 0 && "min-h-[2px]",
                      )}
                      style={{ height: pct(p.value) }}
                    />
                    {isActive && (
                      <div
                        className={cn(
                          "pointer-events-none absolute bottom-full z-10 mb-1.5 min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-pop",
                          align,
                        )}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-2 rounded-[2px] bg-chart-1" />
                            {p.label}
                          </span>
                          <span className="tabular font-semibold text-foreground">
                            {format(p.value)}
                          </span>
                        </div>
                        {prev && pv != null && (
                          <div className="mt-1 flex items-center justify-between gap-4">
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <span className="size-2 rounded-[2px] bg-chart-6" />
                              {prev.labels[i]}
                            </span>
                            <span className="tabular font-medium text-foreground">
                              {format(pv)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex gap-[3px] text-[11px] text-muted-foreground">
            {points.map((p, i) => (
              <span
                key={p.key}
                className={cn(
                  // flex centering keeps an overflowing label centered on its column
                  "flex min-w-0 flex-1 justify-center whitespace-nowrap",
                  step > 1 && i === 0 && "justify-start",
                  step > 1 && i > 0 && i + step >= n && "justify-end",
                  // phones: every other label, so dates never collide
                  (i / step) % 2 === 1 && "max-sm:invisible",
                )}
              >
                {i % step === 0 ? p.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {active != null && points[active]
          ? [
              `${points[active]!.label}: ${format(points[active]!.value)}`,
              prev && prev.values[active] != null
                ? `${prev.previousLabel}, ${prev.labels[active]}: ${format(prev.values[active]!)}`
                : "",
            ]
              .filter(Boolean)
              .join(". ")
          : ""}
      </p>
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          {prev && (
            <thead>
              <tr>
                <td />
                <th scope="col">{prev.currentLabel}</th>
                <th scope="col">{prev.tableLabel}</th>
              </tr>
            </thead>
          )}
          <tbody>
            {points.map((p, i) => (
              <tr key={p.key}>
                <th scope="row">{p.label}</th>
                <td>{format(p.value)}</td>
                {prev && (
                  <td>
                    {prev.labels[i]}: {format(prev.values[i] ?? 0)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Client-side CSV download for report tables (data the user is already allowed to see). */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
