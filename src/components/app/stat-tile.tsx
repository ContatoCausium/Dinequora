import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { KpiDelta } from "@/lib/period-compare";
import { cn } from "@/lib/utils";

/**
 * KPI tile: one number the owner should act on, its label, and an optional context line.
 * Values use foreground ink (never a status color); `tone` only adds a small status marker.
 * `delta` compares with the previous period (icon + signed percent + caption, never color alone);
 * `trend` draws a decorative sparkline (the numbers themselves are in the charts and tables).
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  delta,
  trend,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "negative";
  icon?: ReactNode;
  delta?: KpiDelta | undefined;
  trend?: number[] | undefined;
  className?: string;
}) {
  return (
    <div className={cn("surface @container flex min-w-0 flex-col gap-2 p-4.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[13px] font-medium leading-snug text-muted-foreground">
          {label}
        </span>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      {/* never cut a value: narrower tiles use a smaller size instead of an ellipsis */}
      <div className="whitespace-nowrap text-[22px] font-semibold leading-tight tracking-[-0.02em] @[10rem]:text-[26px]">
        {value}
      </div>
      {delta && <DeltaLine delta={delta} />}
      {hint && (
        <div className="flex min-w-0 items-start gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
          {tone !== "neutral" && (
            <span
              aria-hidden
              className={cn(
                "mt-[5px] size-1.5 shrink-0 rounded-full",
                tone === "positive" && "bg-success",
                tone === "warning" && "bg-warning",
                tone === "negative" && "bg-destructive",
              )}
            />
          )}
          <span className="line-clamp-3">{hint}</span>
        </div>
      )}
      {trend && trend.length > 1 && <Sparkline values={trend} className="mt-auto pt-1" />}
    </div>
  );
}

function DeltaLine({ delta }: { delta: KpiDelta }) {
  const Icon =
    delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] leading-snug">
      {delta.direction ? (
        <>
          <span
            className={cn(
              "tabular inline-flex items-center gap-0.5 font-semibold",
              delta.tone === "positive" && "text-success",
              delta.tone === "negative" && "text-destructive",
              delta.tone === "neutral" && "text-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {delta.text}
          </span>
          <span className="text-muted-foreground">{delta.caption}</span>
        </>
      ) : (
        <span className="text-muted-foreground">{delta.text}</span>
      )}
    </div>
  );
}

/** Decorative trend line (aria-hidden): 2px stroke in the brand series color, soft area below. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 22 - ((v - min) / span) * 20;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <div className={className} aria-hidden>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="block h-7 w-full">
        <polygon points={`0,24 ${pts.join(" ")} 100,24`} fill="var(--chart-1)" opacity={0.1} />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
