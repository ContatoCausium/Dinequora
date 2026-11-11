// Types of scripts/qa/isolated-org.mjs (used by the database integration tests in src/test).
export interface IsolatedMember {
  userId: string;
  role: "owner" | "manager" | "staff";
  /** Grants access to the organization's store (owners see every store anyway). */
  store?: boolean;
}
export interface IsolatedOrg {
  key: string;
  orgId: string;
  locationId: string;
  taxRatePpm: number | null;
  plan: string;
  members: (IsolatedMember & { memberId: string })[];
}
export function isolationKey(label: string): string;
export function isolatedOrg(
  label: string,
  options?: { members?: IsolatedMember[]; taxRatePpm?: number | null; plan?: string },
): IsolatedOrg;
export function createIsolatedOrgSql(org: IsolatedOrg): string;
export function countOrgRowsSql(orgIds: string[]): string;
export function dropIsolatedOrgsSql(orgIds: string[]): string;
export function createTestUsersSql(users: { userId: string; email: string }[]): string;
export function dropTestUsersSql(userIds: string[]): string;
