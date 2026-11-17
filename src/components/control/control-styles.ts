import { buttonVariants } from "@/components/ui/button";

/** Same look as the kit's Input/Textarea (fields here are plain elements inside small forms). */
export const inputCls =
  "flex h-9 min-w-0 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:focus-field aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50";
/** The kit's Button variants, so the Control Center reads like the rest of the product. */
export const btnPrimary = buttonVariants({ variant: "default" });
export const btnGhost = buttonVariants({ variant: "ghost" });
