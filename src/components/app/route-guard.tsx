import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

import { useWorkspace } from "./workspace-context";
import { AppPending, StateCard } from "./states";
import { Button } from "@/components/ui/button";
import { requiredFor } from "@/lib/route-permissions";

/** Shows a "no access" state for modules the member's permissions don't open. UI only — data is
 *  protected server-side regardless. */
export function RouteGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { canAny, permissionsReady } = useWorkspace();
  const required = requiredFor(path);
  if (!required) return <>{children}</>;
  if (!permissionsReady) return <AppPending />;
  if (canAny(required)) return <>{children}</>;
  return (
    <div className="surface mx-auto mt-6 max-w-xl">
      <StateCard
        icon={<Lock className="size-5" strokeWidth={1.75} />}
        title={t("access.noModuleTitle")}
        body={t("access.noModuleBody")}
        action={
          <Button asChild variant="outline">
            <Link to="/">{t("access.backHome")}</Link>
          </Button>
        }
      />
    </div>
  );
}
