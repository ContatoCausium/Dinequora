import { useId } from "react";
import { useTranslation } from "react-i18next";

import { useWorkspace } from "@/components/app/workspace-context";
import { Badge } from "@/components/ui/badge";
import type { OrgRole } from "./team-types";

export function TierBadge({ role }: { role: OrgRole }) {
  const { t } = useTranslation("auth");
  return (
    <Badge variant={role === "owner" ? "outline" : "neutral"} className="whitespace-nowrap">
      {t(`roles.${role}`)}
    </Badge>
  );
}

export function MemberAvatar({ name }: { name: string | null }) {
  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary"
    >
      {initials}
    </span>
  );
}

/** Store multi-select limited to `allowed` (DB ids). Managers only ever get their own stores. */
export function StoreChecklist({
  value,
  onChange,
  allowed,
  disabled,
  legend,
}: {
  value: readonly string[];
  onChange: (v: string[]) => void;
  allowed?: readonly string[] | undefined;
  disabled?: boolean | undefined;
  legend: string;
}) {
  const { t } = useTranslation("team");
  const { org } = useWorkspace();
  const id = useId();
  const list = org.locations.filter((l) => l.dbId && (!allowed || allowed.includes(l.dbId)));
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      {!list.length ? (
        <p className="text-sm text-muted-foreground">{t("page.noStoresAvailable")}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {list.map((l) => {
            const dbId = l.dbId!;
            return (
              <label
                key={l.id}
                htmlFor={`${id}-${l.id}`}
                className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md border px-3 text-sm hover:bg-muted/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              >
                <input
                  id={`${id}-${l.id}`}
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={value.includes(dbId)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...value, dbId] : value.filter((x) => x !== dbId))
                  }
                />
                <span className="truncate">{l.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
