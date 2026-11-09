import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoneyCents } from "@/lib/format";

export type Series = { key: string; label: string; color: string; kind?: "bar" | "line" };

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };

export function ChartLegend({ series }: { series: Series[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={s.kind === "line" ? "h-0.5 w-3 rounded-full" : "size-2 rounded-full"}
            style={{ background: s.color }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

type TooltipEntry = { dataKey?: string | number; value?: number; color?: string };

function MoneyTooltip({
  active,
  payload,
  label,
  lng,
  series,
  formatLabel,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  lng: string;
  series: Series[];
  formatLabel: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-pop">
      <p className="mb-1.5 font-medium text-foreground">{formatLabel(String(label ?? ""))}</p>
      <ul className="space-y-1">
        {series.map((s) => {
          const entry = payload.find((p) => p.dataKey === s.key);
          if (!entry || typeof entry.value !== "number") return null;
          return (
            <li key={s.key} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular font-medium text-foreground">
                {fmtMoneyCents(entry.value, lng)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Money chart with one value axis: bars for flows, optional line for a derived series (result).
 * Data values are integer cents.
 */
export function MoneyChart<T extends Record<string, string | number>>({
  data,
  xKey,
  series,
  lng,
  formatX,
  height = 260,
  ariaLabel,
}: {
  data: T[];
  xKey: keyof T & string;
  series: Series[];
  lng: string;
  formatX: (value: string) => string;
  height?: number;
  ariaLabel: string;
}) {
  const hasLine = series.some((s) => s.kind === "line");
  const Chart = hasLine ? ComposedChart : BarChart;
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ left: 0, right: 4, top: 8, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
            tickFormatter={(v) => formatX(String(v))}
            dy={6}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            // wide enough for negative compact values ("-US$ 40 mil") so the sign is never clipped
            width={84}
            tick={axisTick}
            tickFormatter={(v: number) => fmtMoneyCents(v, lng, { compact: true })}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={<MoneyTooltip lng={lng} series={series} formatLabel={formatX} />}
          />
          {series.map((s) =>
            s.kind === "line" ? (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={1.5}
                dot={{ r: 2.5, strokeWidth: 0, fill: s.color }}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            ) : (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
              />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars (dataviz: no pies/donuts). Values in cents. */
export function RankedBars({
  rows,
  lng,
  color = "var(--chart-1)",
}: {
  rows: { key: string; label: string; cents: number; share: number; meta?: string | undefined }[];
  lng: string;
  color?: string;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium text-foreground">{r.label}</span>
            <span className="tabular shrink-0 text-muted-foreground">
              {fmtMoneyCents(r.cents, lng)}
              {r.meta ? ` · ${r.meta}` : ""}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, r.share * 100))}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
