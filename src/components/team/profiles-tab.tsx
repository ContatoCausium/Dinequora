import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, CopyPlus, Eye, Loader2, Pencil, Plus, ShieldCheck } from "lucide-react";

import { Panel } from "@/components/app/page";
import { EmptyState, Skeleton } from "@/components/app/states";
import { useWorkspace } from "@/components/app/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { archivePermissionProfile, savePermissionProfile } from "@/lib/org-service";
import { capToTier, sameSet, togglePermission } from "./access-model";
import { ConfirmDialog } from "./confirm-dialog";
import { PermissionMatrix } from "./permission-matrix";
import { useProfileText, useTeamError } from "./team-hooks";
import { TierBadge } from "./team-ui";
import {
  auditQueryKey,
  profilesQueryKey,
  teamQueryKey,
  type PermissionProfile,
  type TeamData,
} from "./team-types";

type Draft = {
  id: string | null;
  name: string;
  description: string;
  tier: "manager" | "staff";
  permissions: string[];
  readOnly: boolean;
  inUse: number;
};

export function ProfilesTab({
  profiles,
  loading,
  team,
}: {
  profiles: PermissionProfile[];
  loading: boolean;
  team: TeamData | undefined;
}) {
  const { t } = useTranslation("team");
  const { role, orgDbId } = useWorkspace();
  const qc = useQueryClient();
  const text = useProfileText();
  const isOwner = role === "owner";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archiving, setArchiving] = useState<PermissionProfile | null>(null);

  const usage = useMemo(() => {
    const out = new Map<string, number>();
    for (const m of team?.members ?? [])
      if (m.profile_id && m.role !== "owner")
        out.set(m.profile_id, (out.get(m.profile_id) ?? 0) + 1);
    return out;
  }, [team]);
  const system = profiles.filter((p) => p.is_system);
  const custom = profiles.filter((p) => !p.is_system);

  const open = (p: PermissionProfile, mode: "view" | "edit" | "duplicate") =>
    setDraft({
      id: mode === "edit" ? p.id : null,
      name: mode === "duplicate" ? t("profiles.copyOf", { name: text.name(p) }) : text.name(p),
      description: text.description(p),
      tier: p.tier,
      permissions: capToTier(p.tier, p.permissions),
      readOnly: mode === "view",
      inUse: mode === "edit" ? (usage.get(p.id) ?? 0) : 0,
    });

  const row = (p: PermissionProfile) => {
    const used = usage.get(p.id) ?? 0;
    return (
      <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{text.name(p)}</span>
            <TierBadge role={p.tier} />
            {p.is_system && <Badge variant="neutral">{t("profiles.template")}</Badge>}
          </span>
          {text.description(p) && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {text.description(p)}
            </span>
          )}
        </span>
        <span className="tabular text-xs text-muted-foreground">
          {t("detail.count", { count: capToTier(p.tier, p.permissions).length })}
          {" · "}
          {t("profiles.usedBy", { count: used })}
        </span>
        <span className="flex items-center gap-1">
          {p.is_system || !isOwner ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label={t("profiles.view", { name: text.name(p) })}
              onClick={() => open(p, "view")}
            >
              <Eye className="size-4" strokeWidth={1.75} />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label={t("profiles.edit", { name: text.name(p) })}
              onClick={() => open(p, "edit")}
            >
              <Pencil className="size-4" strokeWidth={1.75} />
            </Button>
          )}
          {isOwner && p.is_system && (
            <Button variant="ghost" size="sm" onClick={() => open(p, "duplicate")}>
              <CopyPlus className="size-3.5" />
              {t("profiles.duplicate")}
            </Button>
          )}
          {isOwner && !p.is_system && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={used ? 0 : -1} className="inline-flex rounded-md">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-destructive"
                    disabled={used > 0}
                    aria-label={t("profiles.archive", { name: text.name(p) })}
                    onClick={() => setArchiving(p)}
                  >
                    <Archive className="size-4" strokeWidth={1.75} />
                  </Button>
                </span>
              </TooltipTrigger>
              {used > 0 && (
                <TooltipContent>{t("profiles.archiveInUse", { count: used })}</TooltipContent>
              )}
            </Tooltip>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={t("profiles.customTitle")}
        subtitle={isOwner ? t("profiles.customSubtitle") : t("profiles.ownerOnly")}
        action={
          isOwner ? (
            <Button
              size="sm"
              onClick={() =>
                setDraft({
                  id: null,
                  name: "",
                  description: "",
                  tier: "staff",
                  permissions: [],
                  readOnly: false,
                  inUse: 0,
                })
              }
            >
              <Plus className="size-4" />
              {t("profiles.new")}
            </Button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : !custom.length ? (
          <EmptyState
            icon={<ShieldCheck className="size-5" strokeWidth={1.75} />}
            title={t("profiles.emptyTitle")}
            body={isOwner ? t("profiles.emptyBody") : undefined}
          />
        ) : (
          <ul className="divide-y">{custom.map(row)}</ul>
        )}
      </Panel>

      <Panel
        title={t("profiles.systemTitle")}
        subtitle={t("profiles.systemSubtitle")}
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <ul className="divide-y">{system.map(row)}</ul>
        )}
      </Panel>

      <Sheet open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[920px]">
          {draft && (
            <ProfileEditor
              key={`${draft.id ?? "new"}:${draft.name}`}
              draft={draft}
              onClose={() => setDraft(null)}
              onSaved={() => {
                void qc.invalidateQueries({ queryKey: profilesQueryKey(orgDbId) });
                void qc.invalidateQueries({ queryKey: teamQueryKey(orgDbId) });
                void qc.invalidateQueries({ queryKey: ["my-permissions"] });
                void qc.invalidateQueries({ queryKey: auditQueryKey(orgDbId) });
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        destructive
        title={t("profiles.archiveTitle", { name: archiving ? text.name(archiving) : "" })}
        body={<p>{t("profiles.archiveBody")}</p>}
        confirmLabel={t("profiles.archiveConfirm")}
        onConfirm={async () => {
          if (!archiving) return;
          await archivePermissionProfile(archiving.id);
          toast.success(t("profiles.archived"));
          void qc.invalidateQueries({ queryKey: profilesQueryKey(orgDbId) });
          void qc.invalidateQueries({ queryKey: auditQueryKey(orgDbId) });
        }}
      />
    </div>
  );
}

function ProfileEditor({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("team");
  const { orgDbId } = useWorkspace();
  const err = useTeamError();
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [tier, setTier] = useState(draft.tier);
  const [perms, setPerms] = useState<Set<string>>(() => new Set(draft.permissions));
  const [serverError, setServerError] = useState<string | null>(null);
  const permList = capToTier(tier, perms);
  const nameValid = name.trim().length >= 2 && name.trim().length <= 60;
  const dirty =
    draft.id === null ||
    name !== draft.name ||
    description !== draft.description ||
    tier !== draft.tier ||
    !sameSet(permList, draft.permissions);

  const save = useMutation({
    mutationFn: () =>
      savePermissionProfile(orgDbId, {
        id: draft.id,
        name: name.trim(),
        description: description.trim(),
        tier,
        permissions: permList,
      }),
    onMutate: () => setServerError(null),
    onSuccess: () => {
      toast.success(t("profiles.saved"));
      onSaved();
      onClose();
    },
    onError: (e) => setServerError(err.message(e)),
  });

  const title = draft.readOnly ? name : draft.id ? t("profiles.editTitle") : t("profiles.newTitle");

  return (
    <>
      <SheetHeader className="border-b px-5 py-4 text-left">
        <SheetTitle className="pr-8 text-base">{title}</SheetTitle>
        <SheetDescription className="text-xs">
          {draft.readOnly ? description : t("profiles.editorHint")}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-5 px-5 py-5">
        {!draft.readOnly && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-name" className="text-sm font-medium">
                {t("profiles.name")}
              </label>
              <Input
                id="profile-name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!nameValid}
                className="h-10"
              />
              {!nameValid && name.length > 0 && (
                <p className="text-xs text-destructive">{t("errors.invalid_name")}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-tier" className="text-sm font-medium">
                {t("detail.tier")}
              </label>
              <Select
                value={tier}
                disabled={draft.inUse > 0}
                onValueChange={(v) => {
                  const next = v as "manager" | "staff";
                  setTier(next);
                  setPerms(new Set(capToTier(next, perms)));
                }}
              >
                <SelectTrigger id="profile-tier" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["manager", "staff"] as const).map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`auth:roles.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {draft.inUse > 0
                  ? t("profiles.tierLocked", { count: draft.inUse })
                  : t("profiles.tierHint")}
              </p>
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label htmlFor="profile-description" className="text-sm font-medium">
                {t("profiles.description")}
              </label>
              <Textarea
                id="profile-description"
                value={description}
                maxLength={240}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-semibold">{t("detail.permissions")}</h3>
            <TierBadge role={tier} />
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {t("detail.count", { count: permList.length })}
            </span>
          </div>
          <PermissionMatrix
            caption={t("profiles.matrixCaption", { name: name || t("profiles.newTitle") })}
            role={tier}
            inherited={null}
            desired={perms}
            onToggle={
              draft.readOnly ? undefined : (p) => setPerms((s) => togglePermission(tier, s, p))
            }
          />
          {draft.inUse > 0 && !draft.readOnly && (
            <p className="text-xs text-muted-foreground">
              {t("profiles.affects", { count: draft.inUse })}
            </p>
          )}
        </div>
      </div>
      {!draft.readOnly && (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background px-5 py-3">
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!dirty || !nameValid || save.isPending}
              aria-busy={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("profiles.save")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
