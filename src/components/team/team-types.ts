import type { fetchTeam, OrgRole, PermissionProfile } from "@/lib/org-service";

export type TeamData = Awaited<ReturnType<typeof fetchTeam>>;
export type TeamMember = TeamData["members"][number];
export type TeamInvite = TeamData["invites"][number];
export type { OrgRole, PermissionProfile };

export const isCustomized = (m: Pick<TeamMember, "extra_permissions" | "revoked_permissions">) =>
  (m.extra_permissions?.length ?? 0) > 0 || (m.revoked_permissions?.length ?? 0) > 0;

export const teamQueryKey = (orgDbId: string) => ["team", orgDbId] as const;
export const profilesQueryKey = (orgDbId: string) => ["permission-profiles", orgDbId] as const;
export const auditQueryKey = (orgDbId: string) => ["audit", orgDbId] as const;
