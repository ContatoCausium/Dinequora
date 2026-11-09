import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { errorCode } from "./access-model";
import type { PermissionProfile } from "./team-types";

/** Translated message for an RPC failure (never shows raw backend text). */
export function useTeamError() {
  const { t } = useTranslation("team");
  const message = useCallback((e: unknown) => t(`errors.${errorCode(e)}`), [t]);
  const show = useCallback((e: unknown) => toast.error(message(e)), [message]);
  return { message, show };
}

/** "POS · Sell" style labels for permissions, modules and actions. */
export function usePermissionLabels() {
  const { t } = useTranslation("team");
  const moduleLabel = useCallback((m: string) => t(`perm.modules.${m}`), [t]);
  const actionLabel = useCallback((a: string) => t(`perm.actions.${a}`), [t]);
  const permLabel = useCallback(
    (p: string) => {
      const i = p.indexOf(".");
      return `${moduleLabel(p.slice(0, i))} · ${actionLabel(p.slice(i + 1))}`;
    },
    [moduleLabel, actionLabel],
  );
  return { moduleLabel, actionLabel, permLabel };
}

/** System templates are product copy (translated); custom profiles are tenant data (as stored). */
export function useProfileText() {
  const { t } = useTranslation("team");
  const name = useCallback(
    (p: Pick<PermissionProfile, "is_system" | "key" | "name">) =>
      p.is_system ? t(`profiles.system.${p.key}.name`, { defaultValue: p.name }) : p.name,
    [t],
  );
  const description = useCallback(
    (p: Pick<PermissionProfile, "is_system" | "key" | "description">) =>
      p.is_system
        ? t(`profiles.system.${p.key}.description`, { defaultValue: p.description })
        : p.description,
    [t],
  );
  return { name, description };
}
