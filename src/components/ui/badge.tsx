import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        // Soft status tones (semantic tokens only; ink is mixed toward foreground for AA contrast).
        success:
          "border-success/25 bg-success/12 font-medium text-[color-mix(in_oklab,var(--success)_70%,var(--foreground))]",
        warning:
          "border-warning/35 bg-warning/15 font-medium text-[color-mix(in_oklab,var(--warning)_45%,var(--foreground))]",
        danger:
          "border-destructive/25 bg-destructive/10 font-medium text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]",
        neutral: "border-border bg-muted font-medium text-muted-foreground",
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
