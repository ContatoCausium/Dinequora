import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RequestErrorKind } from "@/lib/request-error";
export function LoadFailure({ kind, retry }: { kind: RequestErrorKind; retry: () => void }) {
  const { t } = useTranslation("common");
  return (
    <div
      role="alert"
      className="my-4 flex min-w-0 flex-wrap items-center gap-3 text-sm text-destructive"
    >
      <p>{t(`states.${kind}`)}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        <RotateCw className="size-4" />
        {t("states.retry")}
      </Button>
    </div>
  );
}
