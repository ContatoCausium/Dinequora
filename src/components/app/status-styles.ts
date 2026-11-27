import type { ComponentType } from "react";
import { BellRing, Check, CircleDot, Flame, Sparkles, X } from "lucide-react";

export type StatusTone = "neutral" | "brand" | "info" | "warning" | "success" | "danger";

/** Orders: waiting (new/confirmed) → kitchen (in prep) → pickup (ready) → done / cancelled. */
export const ORDER_STATUS_STYLE: Record<
  string,
  { tone: StatusTone; icon: ComponentType<{ className?: string }> }
> = {
  new: { tone: "brand", icon: Sparkles },
  confirmed: { tone: "neutral", icon: CircleDot },
  in_prep: { tone: "info", icon: Flame },
  ready: { tone: "warning", icon: BellRing },
  delivered: { tone: "success", icon: Check },
  cancelled: { tone: "danger", icon: X },
};
