import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { canManageMember } from "@/lib/access-rules";
import { removeMember, setMemberAccess, transferOwnership } from "@/lib/org-service";
import { PERMISSION_CATALOG, effectivePermissions, type Permission } from "@/lib/permissions";
import {
  computeAdjustments,
  diffPermissions,
  exceedingOwn,
  inheritedPermissions,
  sameSet,
  togglePermission,
} from "./access-model";
import { ConfirmDialog } from "./confirm-dialog";
import { PermissionMatrix } from "./permission-matrix";
import { usePermissionLabels, useProfileText, useTeamError } from "./team-hooks";
import { MemberAvatar, StoreChecklist, TierBadge } from "./team-ui";
import {
  auditQueryKey,
  teamQueryKey,
  type OrgRole,
  type PermissionProfile,
  type TeamMember,
} from "./team-types";

const DEFAULT = "__tier_default";

export function MemberAccessSheet({
  member,
  profiles,
  myLocationIds,
  onClose,
}: {
  member: TeamMember | null;
  profiles: PermissionProfile[];
  myLocationIds: string[];
  onClose: () => void;
}) {
  return (
    <Sheet open={!!member} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[920px]">
        {member && (
          <MemberAccessBody
            // Reset local edits whenever the saved record changes.
            key={`${member.id}:${member.role}:${member.profile_id}:${member.extra_permissions.join()}:${member.revoked_permissions.join()}:${member.location_ids.join()}`}
            member={member}
            profiles={profiles}
            myLocationIds={myLocationIds}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function MemberAccessBody({
  member,
  profiles,
  myLocationIds,
  onClose,
}: {
  member: TeamMember;
  profiles: PermissionProfile[];
  myLocationIds: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation("team");
  const ws = useWorkspace();
  const qc = useQueryClient();
  const err = useTeamError();
  const profileText = useProfileText();
  const { permLabel } = usePermissionLabels();

  const isSelf = member.id === ws.memberId;
  const isOwnerEditor = ws.role === "owner";
  const editable =
    !isSelf &&
    (isOwnerEditor ||
      (ws.can("team.manage") &&
        canManageMember(
          { role: ws.role, locationIds: myLocationIds },
          { role: member.role, locationIds: member.location_ids },
        )));

  const profileById = (id: string | null) =>
    id ? (profiles.find((p) => p.id === id) ?? null) : null;
  const savedProfilePerms = profileById(member.profile_id)?.permissions ?? null;
  const savedEffective = useMemo(
    () =>
      effectivePermissions({
        role: member.role,
        profilePermissions: savedProfilePerms,
        extra: member.extra_permissions,
        revoked: member.revoked_permissions,
      }),
    [member, savedProfilePerms],
  );

  const [tier, setTier] = useState<OrgRole>(member.role);
  const [profileId, setProfileId] = useState<string | null>(member.profile_id);
  const [stores, setStores] = useState<string[]>(member.location_ids);
  const [desired, setDesired] = useState<Set<string>>(() => new Set(savedEffective));
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"remove" | "transfer" | null>(null);
  /** Tier/profile change waiting for confirmation because it would drop individual adjustments. */
  const [pendingReset, setPendingReset] = useState<{
    tier: OrgRole;
    profileId: string | null;
  } | null>(null);

  const profilePerms = profileById(profileId)?.permissions ?? null;
  const inherited = useMemo(
    () => new Set<string>(inheritedPermissions(tier, profilePerms)),
    [tier, profilePerms],
  );
  const effective: Permission[] = useMemo(
    () =>
      tier === "owner"
        ? [...PERMISSION_CATALOG]
        : effectivePermissions({
            role: tier,
            profilePermissions: profilePerms,
            ...computeAdjustments(tier, profilePerms, desired),
          }),
    [tier, profilePerms, desired],
  );
  const effectiveSet = useMemo(() => new Set<string>(effective), [effective]);
  const adjustments = computeAdjustments(tier, profilePerms, desired);
  const diff = diffPermissions(savedEffective, effective);
  const storesChanged = tier !== "owner" && !sameSet(stores, member.location_ids);
  const dirty =
    tier !== member.role ||
    (tier !== "owner" && profileId !== member.profile_id) ||
    storesChanged ||
    diff.granted.length > 0 ||
    diff.removed.length > 0;
  const exceeds = ws.role === "manager" ? exceedingOwn(effective, ws.permissions) : [];
  const tierProfiles = profiles.filter((p) => p.tier === tier);
  const storeScope = isOwnerEditor
    ? undefined
    : myLocationIds.filter((id) => ws.org.locations.some((l) => l.dbId === id));

  const applyReset = (nextTier: OrgRole, nextProfile: string | null) => {
    setTier(nextTier);
    setProfileId(nextProfile);
    const perms = profileById(nextProfile)?.permissions ?? null;
    setDesired(new Set(inheritedPermissions(nextTier, perms)));
  };
  // Individual overrides that a tier/profile change would discard (saved ones or unsaved toggles).
  const overridesAtRisk = [...adjustments.extra, ...adjustments.revoked];
  const resetTo = (nextTier: OrgRole, nextProfile: string | null) => {
    if (nextTier === tier && nextProfile === profileId) return;
    if (overridesAtRisk.length > 0) setPendingReset({ tier: nextTier, profileId: nextProfile });
    else applyReset(nextTier, nextProfile);
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: teamQueryKey(ws.orgDbId) });
    void qc.invalidateQueries({ queryKey: ["my-permissions"] });
    void qc.invalidateQueries({ queryKey: auditQueryKey(ws.orgDbId) });
  };

  const save = useMutation({
    mutationFn: () =>
      setMemberAccess(member.id, {
        role: tier,
        profileId: tier === "owner" ? null : profileId,
        extra: adjustments.extra,
        revoked: adjustments.revoked,
        locationIds: tier === "owner" ? [] : stores,
      }),
    onMutate: () => setServerError(null),
    onSuccess: () => {
      toast.success(t("detail.saved"));
      invalidate();
    },
    onError: (e) => setServerError(err.message(e)),
  });

  const name = member.full_name ?? t("page.unnamed");
  const savedProfile = profileById(member.profile_id);

  return (
    <>
      <SheetHeader className="border-b px-5 py-4 text-left">
        <div className="flex items-center gap-3 pr-8">
          <MemberAvatar name={member.full_name} />
          <div className="min-w-0">
            <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="truncate">{name}</span>
              <TierBadge role={member.role} />
              {isSelf && <Badge variant="neutral">{t("page.you")}</Badge>}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {member.role === "owner"
                ? t("detail.ownerAccess")
                : savedProfile
                  ? t("detail.usesProfile", { profile: profileText.name(savedProfile) })
                  : t("detail.usesDefault")}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-6 px-5 py-5">
        {isSelf ? (
          <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {t("detail.isYou")}
          </p>
        ) : !editable ? (
          <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {t("detail.readOnly")}
          </p>
        ) : null}

        {editable && (
          <section className="grid gap-4 md:grid-cols-2" aria-label={t("detail.accessSection")}>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="member-tier">
                {t("detail.tier")}
              </label>
              {isOwnerEditor ? (
                <Select value={tier} onValueChange={(v) => resetTo(v as OrgRole, null)}>
                  <SelectTrigger id="member-tier" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["owner", "manager", "staff"] as const).map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`auth:roles.${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div id="member-tier" className="flex h-10 items-center">
                  <TierBadge role={tier} />
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t("detail.tierOwnerOnly")}
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t(`roleHelp.${tier}`)}</p>
            </div>

            {tier !== "owner" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="member-profile">
                  {t("detail.profile")}
                </label>
                <Select
                  value={profileId ?? DEFAULT}
                  onValueChange={(v) => resetTo(tier, v === DEFAULT ? null : v)}
                >
                  <SelectTrigger id="member-profile" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>{t("detail.tierDefault")}</SelectItem>
                    {tierProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {profileText.name(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("detail.profileHint")}</p>
              </div>
            )}

            {tier !== "owner" && (
              <div className="md:col-span-2">
                <StoreChecklist
                  legend={t("detail.stores")}
                  value={stores}
                  onChange={setStores}
                  allowed={storeScope}
                />
                {stores.length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">{t("detail.noStoresHint")}</p>
                )}
              </div>
            )}
          </section>
        )}

        {!editable && member.role !== "owner" && (
          <p className="text-sm">
            <span className="font-medium">{t("detail.stores")}: </span>
            <StoreNames ids={member.location_ids} />
          </p>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="perm-heading">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="perm-heading" className="text-[13.5px] font-semibold">
                {t("detail.permissions")}
              </h3>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {t("detail.count", { count: effective.length })}
                {" · "}
                {diff.granted.length || diff.removed.length
                  ? t("detail.diff", { added: diff.granted.length, removed: diff.removed.length })
                  : t("detail.noPermissionChanges")}
              </p>
            </div>
            {editable &&
              tier !== "owner" &&
              (adjustments.extra.length > 0 || adjustments.revoked.length > 0) && (
                <Button variant="ghost" size="sm" onClick={() => resetTo(tier, profileId)}>
                  <RotateCcw className="size-3.5" />
                  {t("detail.resetAdjustments")}
                </Button>
              )}
          </div>
          {tier === "owner" && (
            <p className="text-xs text-muted-foreground">{t("detail.ownerAll")}</p>
          )}
          <PermissionMatrix
            caption={t("detail.permissionsOf", { name })}
            role={tier}
            inherited={inherited}
            desired={tier === "owner" ? effectiveSet : desired}
            onToggle={
              editable && tier !== "owner"
                ? (p) => setDesired((d) => togglePermission(tier, d, p))
                : undefined
            }
            lockedReason={
              ws.role === "manager"
                ? (p, on) => (!on && !ws.permissions.has(p) ? t("matrix.beyondOwn") : null)
                : undefined
            }
          />
          {(diff.granted.length > 0 || diff.removed.length > 0) && (
            <div className="flex flex-col gap-1.5 text-xs">
              {diff.granted.length > 0 && (
                <ChangeList label={t("detail.willGrant")} items={diff.granted.map(permLabel)} />
              )}
              {diff.removed.length > 0 && (
                <ChangeList label={t("detail.willRemove")} items={diff.removed.map(permLabel)} />
              )}
            </div>
          )}
          {exceeds.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {t("detail.exceedsOwn", { list: exceeds.map(permLabel).join(", ") })}
            </p>
          )}
        </section>

        {editable && (
          <section
            className="flex flex-col gap-3 rounded-lg border p-4"
            aria-labelledby="danger-heading"
          >
            <h3 id="danger-heading" className="text-[13.5px] font-semibold">
              {t("detail.otherActions")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {isOwnerEditor && member.role !== "owner" && (
                <Button variant="outline" onClick={() => setConfirm("transfer")}>
                  <Crown className="size-4" />
                  {t("transfer.action")}
                </Button>
              )}
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirm("remove")}
              >
                <Trash2 className="size-4" />
                {t("page.remove")}
              </Button>
            </div>
          </section>
        )}
      </div>

      {editable && (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background px-5 py-3">
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">
              {dirty ? t("detail.unsaved") : t("detail.upToDate")}
            </span>
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
              {t("common.close")}
            </Button>
            <Button
              disabled={!dirty || save.isPending || exceeds.length > 0}
              aria-busy={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("detail.save")}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingReset !== null}
        onOpenChange={(o) => !o && setPendingReset(null)}
        title={t("resetConfirm.title")}
        body={
          <>
            <p>{t("resetConfirm.body", { count: overridesAtRisk.length, name })}</p>
            {adjustments.extra.length > 0 && (
              <p>
                <span className="font-medium text-foreground">{t("resetConfirm.added")}</span>{" "}
                {adjustments.extra.map(permLabel).join(", ")}
              </p>
            )}
            {adjustments.revoked.length > 0 && (
              <p>
                <span className="font-medium text-foreground">{t("resetConfirm.removed")}</span>{" "}
                {adjustments.revoked.map(permLabel).join(", ")}
              </p>
            )}
            <p>{t("resetConfirm.note")}</p>
          </>
        }
        confirmLabel={t("resetConfirm.confirm")}
        onConfirm={async () => {
          if (pendingReset) applyReset(pendingReset.tier, pendingReset.profileId);
          setPendingReset(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive
        title={t("page.removeTitle", { name })}
        body={<p>{t("page.removeBody", { org: ws.org.name })}</p>}
        confirmLabel={t("page.remove")}
        onConfirm={async () => {
          await removeMember(member.id);
          toast.success(t("page.removed"));
          invalidate();
          onClose();
        }}
      />
      <ConfirmDialog
        open={confirm === "transfer"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("transfer.title", { name })}
        body={
          <>
            <p>{t("transfer.body1", { name, org: ws.org.name })}</p>
            <p>{t("transfer.body2")}</p>
            <p>{t("transfer.body3")}</p>
          </>
        }
        confirmLabel={t("transfer.confirm")}
        onConfirm={async () => {
          await transferOwnership(ws.orgDbId, member.user_id);
          toast.success(t("transfer.done", { name }));
          invalidate();
          ws.refresh();
          onClose();
        }}
      />
    </>
  );
}

function ChangeList({ label, items }: { label: string; items: string[] }) {
  return (
    <p>
      <span className="font-medium">{label} </span>
      <span className="text-muted-foreground">{items.join(", ")}</span>
    </p>
  );
}

export function StoreNames({ ids, owner }: { ids: readonly string[]; owner?: boolean }) {
  const { t } = useTranslation("team");
  const { org } = useWorkspace();
  if (owner) return <>{t("page.allStores")}</>;
  const names = ids.flatMap((id) => {
    const l = org.locations.find((x) => x.dbId === id);
    return l ? [l.name] : [];
  });
  const hidden = ids.length - names.length;
  if (!ids.length) return <span className="text-muted-foreground">{t("page.noStores")}</span>;
  return (
    <>
      {names.join(", ")}
      {hidden > 0 && (
        <span className="text-muted-foreground">
          {names.length ? " · " : ""}
          {t("page.otherStores", { count: hidden })}
        </span>
      )}
    </>
  );
}
