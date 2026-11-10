import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Minus, Search, Shield, ShieldAlert, UserPlus, X } from "lucide-react";

import {
  btnPrimary,
  inputCls,
  LoadingRows,
  Section,
  Tag,
  useErr,
} from "@/components/control/control-ui";
import {
  listPlatformAdmins,
  setPlatformRole,
  type PlatformAdmin,
  type PlatformRole,
} from "@/lib/admin-service";
import { LoadFailure } from "@/components/control/load-failure";
import { requestErrorKind, type RequestErrorKind } from "@/lib/request-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/control/admins")({
  head: () => ({
    meta: [
      { title: "Administrators · Dinequora Control Center" },
      {
        name: "description",
        content:
          "Manage platform administrator and support roles with audited, reason-required changes.",
      },
      { property: "og:title", content: "Administrators · Dinequora Control Center" },
      {
        property: "og:description",
        content:
          "Manage platform administrator and support roles with audited, reason-required changes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Admins,
});

const PERMISSIONS_MATRIX = [
  {
    action: "managePlatformAdmins",
    platformAdmin: true,
    support: false,
    owner: false,
    manager: false,
    staff: false,
  },
  {
    action: "viewAuditLogs",
    platformAdmin: true,
    support: true,
    owner: false,
    manager: false,
    staff: false,
  },
  {
    action: "editOrgSubscription",
    platformAdmin: true,
    support: false,
    owner: false,
    manager: false,
    staff: false,
  },
  {
    action: "overrideStoreLimit",
    platformAdmin: true,
    support: false,
    owner: false,
    manager: false,
    staff: false,
  },
  {
    action: "assignOrgOwner",
    platformAdmin: true,
    support: false,
    owner: false,
    manager: false,
    staff: false,
  },
  {
    action: "suspendOrganization",
    platformAdmin: true,
    support: false,
    owner: false,
    manager: false,
    staff: false,
  },
  {
    action: "viewOrgMetadata",
    platformAdmin: true,
    support: true,
    owner: false,
    manager: false,
    staff: false,
  },
  {
    action: "viewRestaurantPrivateData",
    platformAdmin: false,
    support: false,
    owner: true,
    manager: true,
    staff: true,
  },
  {
    action: "manageRestaurantMembers",
    platformAdmin: false,
    support: false,
    owner: true,
    manager: true,
    staff: false,
  },
  {
    action: "manageRestaurantLocations",
    platformAdmin: false,
    support: false,
    owner: true,
    manager: true,
    staff: false,
  },
] as const;

function Admins() {
  const { t } = useTranslation("control");
  const errText = useErr();
  const [admins, setAdmins] = useState<PlatformAdmin[] | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | PlatformRole>("all");
  const [loadError, setLoadError] = useState<RequestErrorKind | null>(null);
  const [loading, setLoading] = useState(true);

  // Grant Dialog
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState<PlatformRole>("support");
  const [grantReason, setGrantReason] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);

  // Revoke Dialog
  const [revoking, setRevoking] = useState<PlatformAdmin | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setAdmins(await listPlatformAdmins());
    } catch (e) {
      setAdmins(null);
      setLoadError(requestErrorKind(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredAdmins = useMemo(() => {
    if (!admins) return [];
    const q = search.trim().toLowerCase();
    return admins.filter((a) => {
      if (roleFilter !== "all" && a.role !== roleFilter) return false;
      if (q && !a.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [admins, search, roleFilter]);

  const adminCount = useMemo(
    () => (admins ?? []).filter((a) => a.role === "platform_admin").length,
    [admins],
  );

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (grantReason.trim().length < 3) {
      setGrantError(t("errors.reason_required"));
      return;
    }
    setGrantBusy(true);
    setGrantError(null);
    try {
      await setPlatformRole(grantEmail.trim(), grantRole, true, grantReason.trim());
      toast.success(t("saved"));
      setGrantOpen(false);
      setGrantEmail("");
      setGrantReason("");
      await load();
    } catch (err) {
      setGrantError(errText(err));
    } finally {
      setGrantBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    if (revokeReason.trim().length < 3) {
      setRevokeError(t("errors.reason_required"));
      return;
    }
    if (revoking.role === "platform_admin" && adminCount <= 1) {
      setRevokeError(t("errors.last_admin"));
      return;
    }
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await setPlatformRole(revoking.email, revoking.role, false, revokeReason.trim());
      toast.success(t("saved"));
      setRevoking(null);
      setRevokeReason("");
      await load();
    } catch (err) {
      setRevokeError(errText(err));
    } finally {
      setRevokeBusy(false);
    }
  };

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("nav.admins")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("admins.intro")}</p>
        </div>
        <Button
          onClick={() => {
            setGrantError(null);
            setGrantOpen(true);
          }}
          className="inline-flex items-center gap-2"
        >
          <UserPlus className="size-4" />
          {t("admins.grant")}
        </Button>
      </header>

      <div className="grid gap-6">
        <Section title={t("admins.current")}>
          <div className="border-b p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("admins.searchPlaceholder")}
                  className={`${inputCls} pl-9`}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as "all" | PlatformRole)}
                className="h-9 rounded-md border bg-card px-3 text-sm"
              >
                <option value="all">{t("admins.allRoles")}</option>
                <option value="platform_admin">{t("roles.platform_admin")}</option>
                <option value="support">{t("roles.support")}</option>
              </select>
            </div>
          </div>

          {loadError ? (
            <LoadFailure kind={loadError} retry={() => void load()} />
          ) : loading ? (
            <LoadingRows rows={3} />
          ) : filteredAdmins.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("admins.empty")}</p>
          ) : (
            <ul className="divide-y">
              {filteredAdmins.map((a) => {
                const isLast = a.role === "platform_admin" && adminCount <= 1;
                return (
                  <li
                    key={`${a.user_id}-${a.role}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.email}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Tag tone={a.role === "platform_admin" ? "danger" : "neutral"}>
                          {t(`roles.${a.role}`)}
                        </Tag>
                        {isLast && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                            <ShieldAlert className="size-3" />
                            {t("admins.soleAdminTag")}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isLast}
                      title={isLast ? t("errors.last_admin") : undefined}
                      onClick={() => {
                        setRevokeError(null);
                        setRevokeReason("");
                        setRevoking(a);
                      }}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {t("admins.revoke")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Matrix Section */}
        <Section title={t("admins.matrixTitle")} hint={t("admins.matrixSubtitle")}>
          <div className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("admins.actionCol")}</th>
                  <th className="px-3 py-3 text-center font-semibold text-destructive">
                    {t("roles.platform_admin")}
                  </th>
                  <th className="px-3 py-3 text-center font-semibold text-primary">
                    {t("roles.support")}
                  </th>
                  <th className="px-3 py-3 text-center font-semibold">
                    {t("admins.restaurantOwner")}
                  </th>
                  <th className="px-3 py-3 text-center font-semibold">
                    {t("admins.restaurantStaff")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {PERMISSIONS_MATRIX.map((row) => (
                  <tr key={row.action}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {t(`admins.matrix.${row.action}`)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {row.platformAdmin ? (
                        <Check className="mx-auto size-4 text-success" />
                      ) : (
                        <Minus className="mx-auto size-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {row.support ? (
                        <Check className="mx-auto size-4 text-success" />
                      ) : (
                        <Minus className="mx-auto size-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {row.owner ? (
                        <Check className="mx-auto size-4 text-success" />
                      ) : (
                        <Minus className="mx-auto size-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {row.staff ? (
                        <Check className="mx-auto size-4 text-success" />
                      ) : (
                        <Minus className="mx-auto size-4 text-muted-foreground/40" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {/* Grant Access Modal */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="size-5 text-primary" />
              {t("admins.grantTitle")}
            </DialogTitle>
            <DialogDescription>{t("admins.grantHint")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGrant} className="grid gap-4 py-2">
            <label className="grid gap-1.5 text-sm font-medium">
              {t("admins.email")}
              <input
                className={inputCls}
                type="email"
                required
                placeholder="admin@example.com"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("admins.role")}
              <select
                className={inputCls}
                value={grantRole}
                onChange={(e) => setGrantRole(e.target.value as PlatformRole)}
              >
                <option value="support">
                  {t("roles.support")} ({t("admins.supportDesc")})
                </option>
                <option value="platform_admin">
                  {t("roles.platform_admin")} ({t("admins.adminDesc")})
                </option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("edit.reason")}
              <input
                className={inputCls}
                required
                minLength={3}
                placeholder={t("admins.reasonPlaceholder")}
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
              />
            </label>
            {grantError && (
              <p role="alert" className="text-sm text-destructive">
                {grantError}
              </p>
            )}
            <DialogFooter className="mt-2">
              <Button type="button" variant="ghost" onClick={() => setGrantOpen(false)}>
                {t("edit.cancel")}
              </Button>
              <Button type="submit" disabled={grantBusy} className={btnPrimary}>
                {t("admins.grant")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <ShieldAlert className="size-5" />
              {t("admins.revokeTitle", { email: revoking?.email })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admins.revokeBody", { role: revoking ? t(`roles.${revoking.role}`) : "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              {t("edit.reason")}
              <input
                className={inputCls}
                required
                minLength={3}
                placeholder={t("admins.reasonPlaceholder")}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
              />
            </label>
            {revokeError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {revokeError}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeBusy}>{t("edit.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeBusy || revokeReason.trim().length < 3}
              onClick={(e) => {
                e.preventDefault();
                void handleRevoke();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("admins.confirmRevoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
