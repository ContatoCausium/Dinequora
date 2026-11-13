import { useTranslation } from "react-i18next";
import { Presentation, X } from "lucide-react";
import { usePresentationMode } from "@/components/app/use-presentation-mode";
import { cn } from "@/lib/utils";

/** Header control: start or leave the showcase. Rendered only for demo organizations. */
export function PresentationModeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { available, active, start, stop } = usePresentationMode();
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={active ? stop : start}
      aria-pressed={active}
      title={active ? t("presentation.stop") : t("presentation.startHint")}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
        active
          ? "border-warning bg-warning/15 text-foreground hover:bg-warning/25"
          : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Presentation className="size-4" strokeWidth={1.75} aria-hidden />
      <span className="hidden sm:inline">
        {active ? t("presentation.stop") : t("presentation.start")}
      </span>
    </button>
  );
}

/** Permanent notice while the showcase is on, on every screen, with a way out. */
export function PresentationBanner() {
  const { t } = useTranslation();
  const { active, stop } = usePresentationMode();
  if (!active) return null;
  return (
    <div
      role="status"
      data-testid="presentation-banner"
      className="demo-stripe mb-4 flex flex-wrap items-start gap-3 rounded-md border border-warning bg-warning/10 px-4 py-3 text-sm"
    >
      <Presentation className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t("presentation.bannerTitle")}</p>
        <p className="text-muted-foreground">{t("presentation.bannerBody")}</p>
      </div>
      <button
        type="button"
        onClick={stop}
        className="inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-muted"
      >
        <X className="size-3.5" aria-hidden />
        {t("presentation.stop")}
      </button>
    </div>
  );
}
