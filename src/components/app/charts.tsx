import { useState, type ReactNode } from "react";
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
      <table className="sr-only">
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
    </figure>
  );
}

/** Column chart over time (one series). Hover/focus a column to read its exact value. */
export function ColumnSeries({
  points,
  format,
  caption,
  height = 180,
}: {
  points: { key: string; label: string; value: number }[];
  format: (v: number) => string;
  caption: string;
  height?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value));
  const step = Math.max(1, Math.ceil(points.length / 8)); // ≤ 8 axis labels
  return (
    <figure>
      <div className="relative" style={{ height }}>
        {/* recessive baseline + midline */}
        <div className="absolute inset-x-0 bottom-0 border-t" />
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/60" />
        <div className="absolute inset-0 flex items-end gap-[2px]" aria-hidden>
          {points.map((p) => {
            const h = max > 0 ? (p.value / max) * 100 : 0;
            const isActive = active === p.key;
            return (
              <button
                type="button"
                key={p.key}
                tabIndex={-1}
                onMouseEnter={() => setActive(p.key)}
                onMouseLeave={() => setActive(null)}
                className="group relative flex h-full flex-1 items-end"
              >
                <span
                  className={cn(
                    "w-full rounded-t-[4px] bg-chart-1 transition-opacity",
                    active && !isActive && "opacity-40",
                    p.value > 0 ? "min-h-[2px]" : "",
                  )}
                  style={{ height: `${h}%` }}
                />
                {isActive && (
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-pop">
                    <span className="text-muted-foreground">{p.label}</span>{" "}
                    <span className="tabular font-medium">{format(p.value)}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex gap-[2px] text-[11px] text-muted-foreground" aria-hidden>
        {points.map((p, i) => (
          <span key={p.key} className="flex-1 truncate text-center">
            {i % step === 0 ? p.label : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
