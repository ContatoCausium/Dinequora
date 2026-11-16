import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * KPI tile: one number the owner should act on, its label, and an optional context line.
 * Values use foreground ink (never a status color); `tone` only adds a small status marker.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "negative";
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("surface flex min-w-0 flex-col gap-2 p-4.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="truncate text-[26px] font-semibold leading-tight tracking-[-0.02em]">
        {value}
      </div>
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
          <span className="line-clamp-2">{hint}</span>
        </div>
      )}
    </div>
  );
}
