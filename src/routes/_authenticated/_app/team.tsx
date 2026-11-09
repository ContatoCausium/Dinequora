import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, UserPlus } from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader } from "@/components/app/page";
import { AppError, EmptyState, Skeleton } from "@/components/app/states";
import { StatTile } from "@/components/app/stat-tile";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canInviteWithScope, invitableRoles } from "@/lib/access-rules";
import { fetchPermissionProfiles, fetchTeam } from "@/lib/org-service";
import { ActivityTab } from "@/components/team/activity-tab";
import { InviteDialog } from "@/components/team/invite-dialog";
import { MemberAccessSheet } from "@/components/team/member-access-sheet";
import { MembersTab } from "@/components/team/members-tab";
import { ProfilesTab } from "@/components/team/profiles-tab";
import {
  auditQueryKey,
  isCustomized,
  profilesQueryKey,
  teamQueryKey,
} from "@/components/team/team-types";

export const Route = createFileRoute("/_authenticated/_app/team")({
  head: () => ({
    meta: [
      { title: "Team & access · Servora" },
      {
        name: "description",
        content: "Invite employees, assign stores, set permission profiles and review access.",
      },
      { property: "og:title", content: "Team & access · Servora" },
      {
        property: "og:description",
        content: "Invite employees, assign stores, set permission profiles and review access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamPage,
});

type Tab = "members" | "profiles" | "activity";

function TeamPage() {
  const { t } = useTranslation("team");
  const { org, orgDbId, memberId, role, can, permissionsReady } = useWorkspace();
  const qc = useQueryClient();
  const canView = can("team.view");

  const team = useQuery({
    queryKey: teamQueryKey(orgDbId),
    queryFn: () => fetchTeam(orgDbId),
    enabled: canView,
  });
  const profilesQ = useQuery({
    queryKey: profilesQueryKey(orgDbId),
    queryFn: () => fetchPermissionProfiles(orgDbId),
    enabled: canView,
  });

  const [tab, setTab] = useState<Tab>("members");
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  // Invitation tokens are stored hashed: a link can only be copied in the session that created it.
  const [sessionLinks, setSessionLinks] = useState<Record<string, string>>({});

  if (!permissionsReady && !canView)
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4" role="status">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
      </div>
    );
  if (!canView)
    return (
      <EmptyState
        icon={<Lock className="size-5" strokeWidth={1.75} />}
        title={t("page.noAccessTitle")}
        body={t("page.noAccessBody")}
      />
    );
  if (team.error) return <AppError error={team.error} reset={() => void team.refetch()} />;

  const members = team.data?.members ?? [];
  const invites = team.data?.invites ?? [];
  const profiles = profilesQ.data ?? [];
  const me = members.find((m) => m.id === memberId);
  const myLocationIds = me?.location_ids ?? [];
  const openMember = members.find((m) => m.id === openId) ?? null;
  const canActivity = can("team.activity");
  const activeTab: Tab = tab === "activity" && !canActivity ? "members" : tab;
  const customized = members.filter((m) => m.role !== "owner" && isCustomized(m)).length;

  const inviteRoles = can("team.invite") ? invitableRoles(role) : [];
  const inviteScope =
    role === "owner"
      ? org.locations.flatMap((l) => (l.dbId ? [l.dbId] : []))
      : myLocationIds.filter((id) => org.locations.some((l) => l.dbId === id));
  const inviteBlocked =
    inviteRoles.length > 0 && !canInviteWithScope(inviteRoles, inviteScope)
      ? t("invite.noStores")
      : null;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: teamQueryKey(orgDbId) });
    void qc.invalidateQueries({ queryKey: auditQueryKey(orgDbId) });
  };

  const inviteButton = !inviteRoles.length ? null : inviteBlocked ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md">
          <Button size="sm" disabled>
            <UserPlus className="size-4" />
            {t("invite.open")}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{inviteBlocked}</TooltipContent>
    </Tooltip>
  ) : (
    <Button size="sm" onClick={() => setInviting(true)}>
      <UserPlus className="size-4" />
      {t("invite.open")}
    </Button>
  );

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        eyebrow={<span className="eyebrow">{t("page.eyebrow")}</span>}
        title={t("page.title")}
        description={t("page.subtitle", { org: org.name })}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t("stats.members")}
          value={team.isPending ? "—" : members.length}
          hint={t("stats.membersHint", {
            owners: members.filter((m) => m.role === "owner").length,
            managers: members.filter((m) => m.role === "manager").length,
            staff: members.filter((m) => m.role === "staff").length,
          })}
        />
        <StatTile
          label={t("stats.pending")}
          value={team.isPending ? "—" : invites.length}
          hint={t("stats.pendingHint")}
        />
        <StatTile
          label={t("stats.customized")}
          value={team.isPending ? "—" : customized}
          hint={t("stats.customizedHint")}
          tone={customized > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label={t("stats.profiles")}
          value={profilesQ.isPending ? "—" : profiles.filter((p) => !p.is_system).length}
          hint={t("stats.profilesHint", { count: profiles.filter((p) => p.is_system).length })}
        />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="members">{t("tabs.members")}</TabsTrigger>
            <TabsTrigger value="profiles">{t("tabs.profiles")}</TabsTrigger>
            {canActivity && <TabsTrigger value="activity">{t("tabs.activity")}</TabsTrigger>}
          </TabsList>
          {activeTab === "members" && inviteButton}
        </div>
        <TabsContent value="members" className="mt-0">
          <MembersTab
            data={team.data}
            loading={team.isPending}
            profiles={profiles}
            myLocationIds={myLocationIds}
            sessionLinks={sessionLinks}
            onLinkCreated={(email, url) =>
              setSessionLinks((s) => ({ ...s, [email.toLowerCase()]: url }))
            }
            onOpenMember={(m) => setOpenId(m.id)}
            onChanged={invalidate}
          />
        </TabsContent>
        <TabsContent value="profiles" className="mt-0">
          <ProfilesTab profiles={profiles} loading={profilesQ.isPending} team={team.data} />
        </TabsContent>
        {canActivity && (
          <TabsContent value="activity" className="mt-0">
            <ActivityTab members={members} />
          </TabsContent>
        )}
      </Tabs>

      <MemberAccessSheet
        member={openMember}
        profiles={profiles}
        myLocationIds={myLocationIds}
        onClose={() => setOpenId(null)}
      />
      {inviteRoles.length > 0 && (
        <InviteDialog
          open={inviting}
          onOpenChange={setInviting}
          profiles={profiles}
          scope={inviteScope}
          onCreated={(email, url) => {
            setSessionLinks((s) => ({ ...s, [email.toLowerCase()]: url }));
            invalidate();
          }}
        />
      )}
    </div>
  );
}
