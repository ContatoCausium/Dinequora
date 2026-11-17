import { useId, type ReactNode } from "react";
import type { KpiDelta } from "@/lib/period-compare";
import { cn } from "@/lib/utils";
import { DeltaLine } from "./stat-tile";

export interface MetricStat {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Secondary line under the value (e.g. the day it happened). */
  detail?: ReactNode;
}

/**
 * Hero KPI (redesign stage A, adapted from the Profitize "Progress Metric Card" reference): the
 * headline figure, its comparison with the previous equivalent period, the daily chart behind it
 * and the period's highest / lowest / average in a footer.
 *
 * Ember & Sand rules: every color is a semantic token (tenant brands and dark mode follow); the
 * comparison color comes from `kpiDelta` (green only when the change is good, never by direction
 * alone) and is always paired with an icon and text. The chart is passed as `children` — usually
 * a `ColumnSeries`, which keeps its accessible table, keyboard reading and live region.
 *
 * Layout: figures above the chart; on a wide card (container ≥ 56rem) the chart takes the right
 * three fifths, beside the figures, over the dotted backdrop.
 */
export function MetricCard({
  label,
  value,
  delta,
  hint,
  stats,
  statsNote,
  children,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: KpiDelta | undefined;
  hint?: ReactNode;
  stats?: MetricStat[] | undefined;
  statsNote?: ReactNode;
  /** The chart (or its empty/period note). */
  children?: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      // overflow-hidden keeps the backdrop inside the rounded corners; the chart's tooltip and
      // focus ring sit within the 20px padding, so nothing interactive is clipped.
      className={cn(
        "surface @container relative isolate flex min-w-0 flex-col overflow-hidden",
        className,
      )}
    >
      <div className="grid flex-1 gap-5 p-5 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @4xl:gap-8">
        <div className="flex min-w-0 flex-col gap-2">
          <h2
            id={headingId}
            className="text-[13.5px] font-medium leading-snug text-muted-foreground"
          >
            {label}
          </h2>
          {/* never cut a value: narrower cards use a smaller size instead of an ellipsis */}
          <p className="tabular whitespace-nowrap text-[30px] font-semibold leading-none tracking-[-0.025em] @md:text-[36px] @3xl:text-[40px]">
            {value}
          </p>
          {delta && <DeltaLine delta={delta} className="text-[13px]" />}
          {hint && <p className="text-[12.5px] leading-snug text-muted-foreground">{hint}</p>}
        </div>
        {children && (
          <div className="relative min-w-0">
            <div
              aria-hidden
              data-testid="metric-backdrop"
              className="metric-backdrop pointer-events-none absolute -inset-x-5 -top-3 -bottom-5 -z-10 @4xl:-top-5"
            />
            {children}
          </div>
        )}
      </div>
      {stats && stats.length > 0 && (
        <footer className="border-t px-5 py-3.5">
          <dl className="grid grid-cols-3 gap-3">
            {stats.map((s) => (
              <div key={s.key} className="min-w-0">
                <dt className="text-[11.5px] leading-snug text-muted-foreground">{s.label}</dt>
                <dd className="tabular mt-0.5 text-sm font-semibold leading-snug">{s.value}</dd>
                {s.detail && (
                  <dd className="text-[11.5px] leading-snug text-muted-foreground">{s.detail}</dd>
                )}
              </div>
            ))}
          </dl>
          {statsNote && (
            <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">{statsNote}</p>
          )}
        </footer>
      )}
    </section>
  );
}
