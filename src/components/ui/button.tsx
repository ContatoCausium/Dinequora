import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Ember & Sand buttons. Variant names are kept from the original kit so existing screens keep their
 * meaning: `default` = primary (brand), `outline` = secondary (neutral, bordered), `secondary` and
 * `ghost` = tertiary, `destructive` = irreversible actions, `link` = inline text action.
 * Sizes: sm 32 · default 36 · lg 44 · touch 56 (POS/KDS) · icon variants.
 */
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium cursor-pointer select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-[color-mix(in_oklab,var(--destructive)_88%,black)] active:bg-[color-mix(in_oklab,var(--destructive)_76%,black)]",
        outline:
          "border border-border bg-card text-foreground shadow-xs hover:border-input hover:bg-secondary active:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted active:bg-border",
        ghost: "text-foreground hover:bg-secondary active:bg-muted",
        link: "h-auto rounded-sm px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 gap-1.5 rounded-md px-2.5 text-[13px]",
        lg: "h-11 px-5 text-[15px]",
        touch: "h-14 rounded-xl px-6 text-base font-semibold [&_svg]:size-5",
        icon: "size-9",
        "icon-sm": "size-8 rounded-md",
        "icon-touch": "size-14 rounded-xl [&_svg]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner in place of the leading icon, keeps the width and blocks repeated clicks. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, ...props }, ref) => {
    if (asChild)
      return (
        <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Slot>
      );
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        disabled={props.disabled || loading}
        aria-busy={loading || undefined}
      >
        {loading ? <Spinning>{children}</Spinning> : children}
      </button>
    );
  },
);
Button.displayName = "Button";

/** Replaces the leading icon with a spinner (or prepends one) so the label never jumps. */
function Spinning({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  const first = items[0];
  const leadingIcon =
    React.isValidElement(first) && typeof first.type !== "string" && first.type !== React.Fragment;
  const spinner = <LoaderCircle key="spinner" className="animate-spin" aria-hidden />;
  return <>{leadingIcon ? [spinner, ...items.slice(1)] : [spinner, ...items]}</>;
}

export { Button, buttonVariants };
