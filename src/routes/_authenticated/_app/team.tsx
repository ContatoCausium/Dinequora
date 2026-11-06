import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Copy, Link2, Loader2, MapPin, Minus, Trash2, UserPlus } from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel } from "@/components/app/page";
import { AppError } from "@/components/app/states";
import { Field, isEmail, SubmitButton } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
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
import {
  createInvitation,
  fetchOrgAudit,
  fetchTeam,
  removeMember,
  revokeInvitation,
  setMemberLocations,
  setMemberRole,
  type OrgRole,
} from "@/lib/org-service";
import {
  canManageMember,
  invitableRoles,
  canInviteWithScope,
  isInviteExpired,
} from "@/lib/access-rules";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/team")({
  head: () => ({
    meta: [
      { title: "Team & access · Servora" },
      {
        name: "description",
        content: "Invite employees, assign stores, change roles and review access.",
      },
      { property: "og:title", content: "Team & access · Servora" },
      {
        property: "og:description",
        content: "Invite employees, assign stores, change roles and review access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamPage,
});

type Member = {
  id: string;
  role: OrgRole;
  user_id: string;
  full_name: string | null;
  location_ids: string[];
};

function useErr() {
  const { t } = useTranslation("locations");
  return (e: unknown) =>
    toast.error(
      t(`errors.${(e as Error).message}`, {
        defaultValue: t("team:errors.last_owner_or_unknown", { defaultValue: t("errors.unknown") }),
      }),
    );
}

function TeamPage() {
  const { t, i18n } = useTranslation("team");
  const { org, role, orgDbId, user, memberId } = useWorkspace();
  const qc = useQueryClient();
  const onErr = useErr();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["team", orgDbId],
    queryFn: () => fetchTeam(orgDbId),
  });
  const canManage = role !== "staff";
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["team", orgDbId] });
    void qc.invalidateQueries({ queryKey: ["audit", orgDbId] });
  };
  const members = (data?.members ?? []) as Member[];
  const me = members.find((m) => m.id === memberId);
  const meLite = { role, locationIds: me?.location_ids ?? [] };
  const [storesFor, setStoresFor] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const locName = (id: string) => org.locations.find((l) => l.dbId === id)?.name;

  if (error) return <AppError error={error as Error} reset={() => void refetch()} />;

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        eyebrow={<span className="eyebrow">{t("page.eyebrow")}</span>}
        title={t("page.title")}
        description={t("page.subtitle", { org: org.name })}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title={t("page.members")}
            subtitle={t("page.membersCount", { count: members.length })}
            bodyClassName="p-0"
          >
            {isLoading ? (
              <div className="p-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ul className="divide-y">
                {members.map((m) => {
                  const manageable =
                    m.id !== memberId &&
                    canManageMember(meLite, { role: m.role, locationIds: m.location_ids });
                  const stores =
                    m.role === "owner"
                      ? t("page.allStores")
                      : m.location_ids.map(locName).filter(Boolean).join(", ") ||
                        t("page.noStores");
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                        {(m.full_name ?? "?")
                          .split(" ")
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {m.full_name ?? t("page.unnamed")}
                          {m.user_id === user.id && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {t("page.you")}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPin className="size-3 shrink-0" strokeWidth={1.75} />
                          {stores}
                        </span>
                      </span>
                      <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
                        {role === "owner" && m.id !== memberId ? (
                          <select
                            aria-label={t("page.changeRole")}
                            value={m.role}
                            onChange={async (e) => {
                              try {
                                await setMemberRole(m.id, e.target.value as OrgRole);
                                toast.success(t("page.roleChanged"));
                                invalidate();
                              } catch (err) {
                                onErr(err);
                              }
                            }}
                            className="h-9 rounded-md border bg-background px-2 text-xs font-medium"
                          >
                            {(["owner", "manager", "staff"] as OrgRole[]).map((r) => (
                              <option key={r} value={r}>
                                {t(`auth:roles.${r}`)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <RoleChip role={m.role} />
                        )}
                        {manageable && m.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9"
                            aria-label={t("page.assignStores")}
                            title={t("page.assignStores")}
                            onClick={() => setStoresFor(m)}
                          >
                            <MapPin className="size-4" strokeWidth={1.75} />
                          </Button>
                        )}
                        {manageable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9 text-muted-foreground hover:text-destructive"
                            aria-label={t("page.remove")}
                            title={t("page.remove")}
                            onClick={() => setRemoving(m)}
                          >
                            <Trash2 className="size-4" strokeWidth={1.75} />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          {canManage && (
            <Panel title={t("page.pending")} bodyClassName="p-0">
              {!data?.invites.length ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">{t("page.noPending")}</p>
              ) : (
                <ul className="divide-y">
                  {data.invites.map((i) => {
                    const allowed =
                      role === "owner" ||
                      (i.role === "staff" &&
                        (i.location_ids ?? []).every((x: string) =>
                          meLite.locationIds.includes(x),
                        ));
                    return (
                      <li key={i.id} className="flex items-center gap-3 px-5 py-3.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{i.email}</span>
                          {isInviteExpired(i.expires_at) ? (
                            <span className="block text-xs font-medium text-destructive">
                              {t("page.expired")}
                            </span>
                          ) : (
                            <span className="block text-xs text-muted-foreground">
                              {t("page.expires", {
                                date: fmtDate(i.expires_at, i18n.language, {
                                  month: "short",
                                  day: "numeric",
                                }),
                              })}
                            </span>
                          )}
                        </span>
                        <RoleChip role={i.role} />
                        {allowed && (
                          <button
                            className="min-h-9 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={async () => {
                              try {
                                await revokeInvitation(i.id);
                                toast.success(t("page.revoked"));
                                invalidate();
                              } catch (err) {
                                onErr(err);
                              }
                            }}
                          >
                            {t("page.revoke")}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}
          <PermissionsPanel />
          {canManage && <ActivityPanel />}
        </div>
        <InviteForm
          roles={invitableRoles(role)}
          scope={
            role === "owner"
              ? org.locations.map((l) => l.dbId!).filter(Boolean)
              : meLite.locationIds
          }
          onCreated={invalidate}
        />
      </div>

      {storesFor && (
        <StoresDialog
          member={storesFor}
          scope={role === "owner" ? undefined : meLite.locationIds}
          onClose={() => setStoresFor(null)}
          onSaved={invalidate}
        />
      )}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("page.removeTitle", { name: removing?.full_name ?? t("page.unnamed") })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("page.removeBody", { org: org.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("locations:form.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!removing) return;
                try {
                  await removeMember(removing.id);
                  toast.success(t("page.removed"));
                  invalidate();
                } catch (err) {
                  onErr(err);
                }
                setRemoving(null);
              }}
            >
              {t("page.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StoreChecklist({
  value,
  onChange,
  allowed,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  allowed?: string[] | undefined;
}) {
  const { t } = useTranslation("team");
  const { org } = useWorkspace();
  const list = org.locations.filter((l) => l.dbId && (!allowed || allowed.includes(l.dbId)));
  if (!list.length)
    return <p className="text-sm text-muted-foreground">{t("page.noStoresAvailable")}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((l) => (
        <label
          key={l.id}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 hover:bg-muted/60"
        >
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={value.includes(l.dbId!)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, l.dbId!] : value.filter((x) => x !== l.dbId))
            }
          />
          <span className="text-sm">{l.name}</span>
        </label>
      ))}
    </div>
  );
}

function StoresDialog({
  member,
  scope,
  onClose,
  onSaved,
}: {
  member: Member;
  scope?: string[] | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("team");
  const onErr = useErr();
  const [value, setValue] = useState(member.location_ids);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("page.assignStores")}</DialogTitle>
          <DialogDescription>
            {t("page.assignBody", { name: member.full_name ?? t("page.unnamed") })}
          </DialogDescription>
        </DialogHeader>
        <StoreChecklist value={value} onChange={setValue} allowed={scope} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("locations:form.cancel")}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setMemberLocations(member.id, value);
                toast.success(t("page.storesSaved"));
                onSaved();
                onClose();
              } catch (err) {
                onErr(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("locations:form.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MATRIX: {
  key: string;
  owner: boolean;
  manager: boolean | "scoped";
  staff: boolean | "scoped";
}[] = [
  { key: "viewDashboard", owner: true, manager: "scoped", staff: "scoped" },
  { key: "editLocations", owner: true, manager: "scoped", staff: false },
  { key: "addLocations", owner: true, manager: false, staff: false },
  { key: "inviteStaff", owner: true, manager: "scoped", staff: false },
  { key: "inviteManagers", owner: true, manager: false, staff: false },
  { key: "changeRoles", owner: true, manager: false, staff: false },
  { key: "billing", owner: true, manager: false, staff: false },
];

function PermissionsPanel() {
  const { t } = useTranslation("team");
  const cell = (v: boolean | "scoped") =>
    v === "scoped" ? (
      <span className="text-xs text-muted-foreground">{t("perms.scoped")}</span>
    ) : v ? (
      <Check className="mx-auto size-4 text-success" aria-label={t("perms.yes")} />
    ) : (
      <Minus className="mx-auto size-4 text-muted-foreground/60" aria-label={t("perms.no")} />
    );
  return (
    <Panel
      title={t("perms.title")}
      subtitle={t("perms.subtitle")}
      bodyClassName="overflow-x-auto p-0"
    >
      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="px-3 py-2.5 text-left font-medium sm:px-5">{t("perms.action")}</th>
            {(["owner", "manager", "staff"] as const).map((r) => (
              <th key={r} className="px-1.5 py-2.5 text-center font-medium sm:px-3">
                {t(`auth:roles.${r}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {MATRIX.map((row) => (
            <tr key={row.key}>
              <td className="px-3 py-2.5 sm:px-5">{t(`perms.rows.${row.key}`)}</td>
              <td className="px-1.5 text-center sm:px-3">{cell(row.owner)}</td>
              <td className="px-1.5 text-center sm:px-3">{cell(row.manager)}</td>
              <td className="px-1.5 text-center sm:px-3">{cell(row.staff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ActivityPanel() {
  const { t, i18n } = useTranslation("team");
  const { orgDbId } = useWorkspace();
  const { data } = useQuery({
    queryKey: ["audit", orgDbId],
    queryFn: () => fetchOrgAudit(orgDbId, 20),
  });
  return (
    <Panel title={t("activity.title")} subtitle={t("activity.subtitle")} bodyClassName="p-0">
      {!data?.length ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{t("activity.empty")}</p>
      ) : (
        <ol className="divide-y">
          {data.map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-4 px-5 py-3 text-sm">
              <span className="min-w-0 truncate">
                {t(`control:actions.${a.action}`, { defaultValue: a.action })}
                {(a.action.startsWith("invitation") || a.action.startsWith("location")) &&
                a.target ? (
                  <span className="text-muted-foreground"> · {a.target}</span>
                ) : null}
              </span>
              <span className="tabular shrink-0 text-xs text-muted-foreground">
                {fmtDate(a.created_at, i18n.language, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function RoleChip({ role }: { role: OrgRole }) {
  const { t } = useTranslation("auth");
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium",
        role === "owner"
          ? "border-primary/30 bg-primary-soft text-primary"
          : "text-muted-foreground",
      )}
    >
      {t(`roles.${role}`)}
    </span>
  );
}

function InviteForm({
  roles,
  scope,
  onCreated,
}: {
  roles: OrgRole[];
  scope: string[];
  onCreated: () => void;
}) {
  const { t } = useTranslation("team");
  const { orgDbId } = useWorkspace();
  const onErr = useErr();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("staff");
  const [stores, setStores] = useState<string[]>([]);
  const [err, setErr] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);

  if (!roles.length)
    return (
      <Panel title={t("invite.title")}>
        <p className="text-sm text-muted-foreground">{t("invite.readOnly")}</p>
      </Panel>
    );
  if (!canInviteWithScope(roles, scope))
    return (
      <Panel title={t("invite.title")}>
        <p className="text-sm text-muted-foreground">{t("invite.noStores")}</p>
      </Panel>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setErr(t("auth:errors.email"));
    setErr(undefined);
    setLoading(true);
    try {
      const url = await createInvitation(
        orgDbId,
        email.trim(),
        role,
        role === "owner" ? [] : stores,
      );
      setLink({ url, email: email.trim() });
      setEmail("");
      setStores([]);
      onCreated();
    } catch (er) {
      onErr(er);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title={t("invite.title")} subtitle={t("invite.subtitle")} className="self-start">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          id="invite-email"
          type="email"
          label={t("invite.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={err}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">{t("invite.role")}</legend>
          {roles.map((r) => (
            <label
              key={r}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                role === r ? "border-primary/50 bg-primary-soft/50" : "hover:bg-muted/60",
              )}
            >
              <input
                type="radio"
                name="role"
                value={r}
                checked={role === r}
                onChange={() => setRole(r)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span>
                <span className="block text-sm font-medium">{t(`auth:roles.${r}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`roleHelp.${r}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {role !== "owner" && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">{t("invite.stores")}</legend>
            <StoreChecklist value={stores} onChange={setStores} allowed={scope} />
          </fieldset>
        )}
        <SubmitButton loading={loading}>
          <UserPlus className="size-4" />
          {t("invite.submit")}
        </SubmitButton>
      </form>
      {link && (
        <div className="mt-5 rounded-lg border bg-muted/40 p-3.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Link2 className="size-4" />
            {t("invite.linkTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("invite.linkBody", { email: link.email })}
          </p>
          <div className="mt-2.5 flex gap-2">
            <input
              readOnly
              value={link.url}
              aria-label={t("invite.linkTitle")}
              className="h-9 min-w-0 flex-1 rounded-md border bg-card px-2 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(link.url);
                toast.success(t("invite.copied"));
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted"
            >
              <Copy className="size-3.5" />
              {t("invite.copy")}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
