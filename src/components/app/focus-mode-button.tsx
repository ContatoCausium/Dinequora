import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useFocusMode } from "@/lib/focus-mode";
import { cn } from "@/lib/utils";

/** Enters/leaves focus mode (full screen without the app chrome) on POS and kitchen screens. */
export function FocusModeButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const focus = useFocusMode();
  if (!focus.available) return null;
  return (
    <Button
      variant="outline"
      onClick={focus.toggle}
      aria-pressed={focus.active}
      className={cn("h-12 gap-2 px-3.5", className)}
    >
      {focus.active ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
      <span className="max-sm:sr-only">{focus.active ? t("focus.exit") : t("focus.enter")}</span>
    </Button>
  );
}
