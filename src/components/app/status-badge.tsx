import type { ComponentType, ReactNode } from "react";
import { CircleDot } from "lucide-react";
import { ORDER_STATUS_STYLE, type StatusTone } from "@/components/app/status-styles";

import { Badge } from "@/components/ui/badge";

/**
 * Status pill with icon + label (redesign phase 3): status is never conveyed by color alone, and each
 * domain uses one vocabulary everywhere it appears (table, drawer, kitchen, overview).
 */

export function StatusBadge({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: StatusTone;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge variant={tone} className={className}>
      {Icon && <Icon aria-hidden />}
      {children}
    </Badge>
  );
}

export function OrderStatusBadge({ status, label }: { status: string; label: ReactNode }) {
  const s = ORDER_STATUS_STYLE[status] ?? { tone: "neutral" as const, icon: CircleDot };
  return (
    <StatusBadge tone={s.tone} icon={s.icon}>
      {label}
    </StatusBadge>
  );
}
