import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  MATRIX_COLUMNS,
  cellState,
  matrixRows,
  permissionAction,
  type CellState,
} from "./access-model";
import { usePermissionLabels } from "./team-hooks";
import type { OrgRole } from "./team-types";

const ROWS = matrixRows();

/**
 * Permission matrix: rows = modules, columns = View · Create · Edit · Delete · Approve · Other.
 * `inherited` = what the profile / tier default grants (member mode shows +/− markers against it);
 * pass null in profile mode (plain on/off). Without `onToggle` the matrix is read-only.
 */
export function PermissionMatrix({
  role,
  inherited,
  desired,
  onToggle,
  lockedReason,
  caption,
}: {
  role: OrgRole;
  inherited: ReadonlySet<string> | null;
  desired: ReadonlySet<string>;
  onToggle?: ((p: Permission) => void) | undefined;
  /** Extra reason a toggle is locked for this editor (e.g. beyond a manager's own permissions). */
  lockedReason?: ((p: Permission, on: boolean) => string | null) | undefined;
  caption: string;
}) {
  const { t } = useTranslation("team");
  const { moduleLabel } = usePermissionLabels();
  const plain = inherited === null;
  const empty = useMemo(() => new Set<string>(), []);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col gap-2">
        {!plain && role !== "owner" && <MatrixLegend />}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium"
                >
                  {t("matrix.module")}
                </th>
                {MATRIX_COLUMNS.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn(
                      "px-2 py-2 font-medium",
                      c === "other" ? "text-left" : "w-[84px] text-center",
                    )}
                  >
                    {t(`matrix.columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {ROWS.map((row) => (
                <tr key={row.module} className="align-middle">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[13px] font-medium"
                  >
                    {moduleLabel(row.module)}
                  </th>
                  {(["view", "create", "edit", "delete", "approve"] as const).map((c) => {
                    const p = row.cells[c];
                    return (
                      <td key={c} className="px-2 py-1.5 text-center">
                        {p ? (
                          <PermToggle
                            perm={p}
                            state={cellState(p, role, plain ? empty : inherited, desired)}
                            plain={plain}
                            on={role === "owner" || desired.has(p)}
                            onToggle={onToggle}
                            lockedReason={lockedReason}
                          />
                        ) : (
                          <span className="sr-only">{t("matrix.notApplicable")}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5">
                    {row.other.length ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {row.other.map((p) => (
                          <PermToggle
                            key={p}
                            perm={p}
                            labelled
                            state={cellState(p, role, plain ? empty : inherited, desired)}
                            plain={plain}
                            on={role === "owner" || desired.has(p)}
                            onToggle={onToggle}
                            lockedReason={lockedReason}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="sr-only">{t("matrix.notApplicable")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}

function MatrixLegend() {
  const { t } = useTranslation("team");
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <Marker state="added" />
        {t("matrix.legend.added")}
      </li>
      <li className="flex items-center gap-1.5">
        <Marker state="removed" />
        {t("matrix.legend.removed")}
      </li>
      <li>{t("matrix.legend.inherited")}</li>
    </ul>
  );
}

function Marker({ state }: { state: CellState }) {
  if (state !== "added" && state !== "removed") return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-sm border text-[11px] font-semibold leading-none",
        state === "added"
          ? "border-primary/40 text-primary"
          : "border-warning/50 text-[color-mix(in_oklab,var(--warning)_45%,var(--foreground))]",
      )}
    >
      {state === "added" ? "+" : "−"}
    </span>
  );
}

function PermToggle({
  perm,
  state,
  on,
  plain,
  labelled,
  onToggle,
  lockedReason,
}: {
  perm: Permission;
  state: CellState;
  on: boolean;
  plain: boolean;
  labelled?: boolean;
  onToggle?: ((p: Permission) => void) | undefined;
  lockedReason?: ((p: Permission, on: boolean) => string | null) | undefined;
}) {
  const { t } = useTranslation("team");
  const { permLabel, actionLabel } = usePermissionLabels();
  const unavailable = state === "unavailable";
  const reason = unavailable ? t("matrix.unavailable") : (lockedReason?.(perm, on) ?? null);
  const disabled = unavailable || !onToggle || Boolean(reason);
  const stateText =
    plain || state === "inherited" || state === "off" || unavailable
      ? ""
      : `, ${t(`matrix.legend.${state}`)}`;

  const control = (
    <span className={cn("inline-flex items-center gap-1.5", labelled && "min-h-8")}>
      <Switch
        checked={on && !unavailable}
        disabled={disabled}
        onCheckedChange={() => onToggle?.(perm)}
        aria-label={`${permLabel(perm)}${stateText}${reason ? `, ${reason}` : ""}`}
        className={cn(state === "removed" && "ring-1 ring-warning/60 ring-offset-1")}
      />
      {labelled && (
        <span
          className={cn(
            "text-[13px]",
            unavailable ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {actionLabel(permissionAction(perm))}
        </span>
      )}
      {!plain && <Marker state={state} />}
    </span>
  );

  if (!reason) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md">
          {control}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
