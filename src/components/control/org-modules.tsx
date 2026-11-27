import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { listOrgModules, setOrgModule } from "@/lib/admin-service";

/**
 * Control Center > organization > Modules: the platform admin turns a module (feature) on or off for
 * this organization. Each change goes through admin_set_org_feature (platform admin only, audited).
 * A module that is off hides its permissions for everyone in the organization, owners included.
 */
export function OrgModules({ orgId }: { orgId: string }) {
  const { t } = useTranslation("control");
  const qc = useQueryClient();
  const key = ["org-modules", orgId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => listOrgModules(orgId) });
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(feature: string, enabled: boolean) {
    setBusy(feature);
    try {
      await setOrgModule(orgId, feature, enabled);
      toast.success(
        t(enabled ? "modules.turnedOn" : "modules.turnedOff", {
          name: t(`modules.names.${feature}`, { defaultValue: feature }),
        }),
      );
    } catch {
      toast.error(t("modules.failed"));
    } finally {
      await qc.invalidateQueries({ queryKey: key });
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="mb-1 text-sm font-semibold">{t("modules.title")}</p>
      <p className="mb-2 text-xs text-muted-foreground">{t("modules.hint")}</p>
      {q.isError ? (
        <p className="text-sm text-destructive">{t("modules.loadFailed")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {(q.data ?? []).map((m) => {
            const name = t(`modules.names.${m.key}`, { defaultValue: m.key });
            return (
              <li key={m.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{name}</span>
                  <span className="block text-xs text-muted-foreground">{m.description}</span>
                </span>
                <Switch
                  checked={m.enabled}
                  disabled={busy !== null}
                  aria-label={t("modules.toggle", { name })}
                  onCheckedChange={(on) => void toggle(m.key, on)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
