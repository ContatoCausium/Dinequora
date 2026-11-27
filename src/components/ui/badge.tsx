import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Status pills (Ember & Sand). Soft tone + ink mixed toward the foreground so every pair stays ≥ 4.5:1;
 * status meaning must also be carried by the label (and an icon where it helps), never color alone.
 * `default` (solid brand) and `destructive` (solid crimson) are for counts/emphasis, not status.
 */
const badgeVariants = cva(
  "inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border bg-card text-foreground",
        brand:
          "border-[color-mix(in_oklab,var(--primary)_22%,transparent)] bg-primary-soft text-[color-mix(in_oklab,var(--primary)_82%,var(--foreground))]",
        success:
          "border-success/20 bg-success/10 text-[color-mix(in_oklab,var(--success)_80%,var(--foreground))]",
        warning:
          "border-warning/25 bg-warning/10 text-[color-mix(in_oklab,var(--warning)_80%,var(--foreground))]",
        danger:
          "border-destructive/20 bg-destructive/8 text-[color-mix(in_oklab,var(--destructive)_82%,var(--foreground))]",
        info: "border-info/20 bg-info/10 text-[color-mix(in_oklab,var(--info)_82%,var(--foreground))]",
        neutral: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

// A badge is inline (phrasing) content: rendering it as <span> keeps it valid inside <p>, headings
// and labels, which a <div> is not (React reports that nesting as a hydration error).
function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
