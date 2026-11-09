import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronRight, Copy, MailX, RefreshCw, Users } from "lucide-react";

import { Panel } from "@/components/app/page";
import { EmptyState, Skeleton } from "@/components/app/states";
import { useWorkspace } from "@/components/app/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isInviteExpired } from "@/lib/access-rules";
import { createInvitation, revokeInvitation } from "@/lib/org-service";
import { fmtDate } from "@/lib/format";
import { ConfirmDialog } from "./confirm-dialog";
import { StoreNames } from "./member-access-sheet";
import { useProfileText } from "./team-hooks";
import { MemberAvatar, TierBadge } from "./team-ui";
import {
  isCustomized,
  type PermissionProfile,
  type TeamData,
  type TeamInvite,
  type TeamMember,
} from "./team-types";

export function MembersTab({
  data,
  loading,
  profiles,
  myLocationIds,
  sessionLinks,
  onLinkCreated,
  onOpenMember,
  onChanged,
}: {
  data: TeamData | undefined;
  loading: boolean;
  profiles: PermissionProfile[];
  myLocationIds: string[];
  sessionLinks: Record<string, string>;
  /** Remember a freshly issued link for this page session (the DB stores only its hash). */
  onLinkCreated: (email: string, url: string) => void;
  onOpenMember: (m: TeamMember) => void;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation("team");
  const { memberId, role, can, orgDbId } = useWorkspace();
  const profileText = useProfileText();
  const [revoking, setRevoking] = useState<TeamInvite | null>(null);
  const [reissuing, setReissuing] = useState<TeamInvite | null>(null);
  const members = data?.members ?? [];
  const invites = data?.invites ?? [];
  const profileName = (id: string | null) => {
    const p = id ? profiles.find((x) => x.id === id) : null;
    return p ? profileText.name(p) : null;
  };
  const canRevoke = (i: TeamInvite) =>
    can("team.invite") &&
    (role === "owner" ||
      (role === "manager" &&
        i.role === "staff" &&
        (i.location_ids ?? []).every((x) => myLocationIds.includes(x))));

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={t("page.members")}
        subtitle={t("page.membersCount", { count: members.length })}
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-5" role="status" aria-label={t("common.loading")}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : !members.length ? (
          <EmptyState
            icon={<Users className="size-5" strokeWidth={1.75} />}
            title={t("page.emptyMembers")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    {t("table.member")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("table.tier")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("table.profile")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("table.stores")}
                  </th>
                  <th scope="col" className="w-12 px-3 py-2.5">
                    <span className="sr-only">{t("table.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {members.map((m) => {
                  const name = m.full_name ?? t("page.unnamed");
                  return (
                    <tr
                      key={m.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => onOpenMember(m)}
                    >
                      <td className="px-5 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <MemberAvatar name={m.full_name} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{name}</span>
                            {m.id === memberId && (
                              <span className="block text-xs text-muted-foreground">
                                {t("page.you")}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <TierBadge role={m.role} />
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={m.profile_id ? "" : "text-muted-foreground"}>
                            {m.role === "owner"
                              ? t("table.fullAccess")
                              : (profileName(m.profile_id) ?? t("detail.tierDefault"))}
                          </span>
                          {m.role !== "owner" && isCustomized(m) && (
                            <Badge variant="warning">{t("table.customized")}</Badge>
                          )}
                        </span>
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-2.5 text-[13px]">
                        <StoreNames ids={m.location_ids} owner={m.role === "owner"} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          aria-label={t("table.open", { name })}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenMember(m);
                          }}
                        >
                          <ChevronRight className="size-4" strokeWidth={1.75} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {can("team.invite") && (
        <Panel title={t("page.pending")} subtitle={t("page.pendingHint")} bodyClassName="p-0">
          {!invites.length ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">{t("page.noPending")}</p>
          ) : (
            <ul className="divide-y">
              {invites.map((i) => {
                const link = sessionLinks[i.email.toLowerCase()];
                const expired = isInviteExpired(i.expires_at);
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{i.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {i.role === "owner"
                          ? t("page.allStores")
                          : (profileName(i.profile_id) ?? t("detail.tierDefault"))}
                        {i.role !== "owner" && (
                          <>
                            {" · "}
                            <StoreNames ids={i.location_ids ?? []} />
                          </>
                        )}
                      </span>
                    </span>
                    <TierBadge role={i.role} />
                    {expired ? (
                      <Badge variant="danger">{t("page.expiredShort")}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("page.expires", {
                          date: fmtDate(i.expires_at, i18n.language, {
                            month: "short",
                            day: "numeric",
                          }),
                        })}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      {link && !expired && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(link);
                              toast.success(t("invite.copied"));
                            } catch {
                              toast.error(t("invite.copyFailed"));
                            }
                          }}
                        >
                          <Copy className="size-3.5" />
                          {t("invite.copy")}
                        </Button>
                      )}
                      {canRevoke(i) && (!link || expired) && (
                        <Button variant="ghost" size="sm" onClick={() => setReissuing(i)}>
                          <RefreshCw className="size-3.5" />
                          {expired ? t("reissue.actionExpired") : t("reissue.action")}
                        </Button>
                      )}
                      {canRevoke(i) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => setRevoking(i)}
                        >
                          <MailX className="size-3.5" />
                          {t("page.revoke")}
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      <ConfirmDialog
        open={!!reissuing}
        onOpenChange={(o) => !o && setReissuing(null)}
        title={t("reissue.title", { email: reissuing?.email ?? "" })}
        body={
          <>
            <p>{t("reissue.body")}</p>
            <p>{t("reissue.note")}</p>
          </>
        }
        confirmLabel={t("reissue.confirm")}
        onConfirm={async () => {
          if (!reissuing) return;
          // Issue the new invitation first (same tier, profile and stores), then retire the old one,
          // so a failure never leaves the person without any valid invitation.
          const url = await createInvitation(
            orgDbId,
            reissuing.email,
            reissuing.role,
            reissuing.location_ids ?? [],
            reissuing.profile_id,
          );
          await revokeInvitation(reissuing.id);
          onLinkCreated(reissuing.email, url);
          try {
            await navigator.clipboard.writeText(url);
            toast.success(t("reissue.doneCopied"));
          } catch {
            toast.success(t("reissue.done"));
          }
          onChanged();
        }}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        destructive
        title={t("page.revokeTitle", { email: revoking?.email ?? "" })}
        body={<p>{t("page.revokeBody")}</p>}
        confirmLabel={t("page.revoke")}
        onConfirm={async () => {
          if (!revoking) return;
          await revokeInvitation(revoking.id);
          toast.success(t("page.revoked"));
          onChanged();
        }}
      />
    </div>
  );
}
