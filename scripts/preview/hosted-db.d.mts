// Types of scripts/preview/hosted-db.mjs (used by src/test/client-preview-hosted-db.test.ts).
export const HOSTED_DB_OPERATIONS: readonly [
  "db-inspect:client-preview",
  "db-migrate:client-preview",
  "db-mark:client-preview",
  "db-functions:client-preview",
];
export const IDENTITY_SQL: string;
export const FUNCTIONS_SQL: string;
export function redact(text: unknown, secrets?: readonly unknown[]): string;
export function parseForbiddenRefs(raw: string | undefined, ref: string): readonly string[];
export function parseHostedDbUrl(
  raw: string | undefined,
  ref: string,
): {
  ref: string;
  host: string;
  user: string;
  sessionUrl: string;
  connectionUrl: string;
  secrets: string[];
};
export type ServerCa = Readonly<{
  file: string;
  pem: string;
  certs: readonly Readonly<{ subject: string; sha256: string; validTo: string }>[];
}>;
export function loadServerCa(file: string | undefined, now?: number): ServerCa;
export type HostedDbTarget = Readonly<{
  operation: string;
  ref: string;
  host: string;
  sessionUrl: string;
  connectionUrl: string;
  ca: ServerCa;
  forbidden: readonly string[];
  personalOwners: readonly string[] | null;
  secrets: readonly string[];
}>;
export function assertHostedPreviewDb(
  env: Record<string, string | undefined>,
  operation: string,
): HostedDbTarget;
export function assertHostedDbTarget(target: unknown): void;
export function tlsOptions(target: HostedDbTarget): Readonly<{
  ca: string;
  rejectUnauthorized: true;
  servername: string;
  checkServerIdentity: typeof import("node:tls").checkServerIdentity;
  minVersion: "TLSv1.2";
}>;
export function describeTls(target: HostedDbTarget): string[];
export type DbSession = {
  query: (text: string) => Promise<Record<string, unknown>[]>;
  end?: () => Promise<unknown>;
};
export type DbFacts = {
  user: string;
  database: string;
  versionNum: number;
  publicRelations: number;
  publicFunctions: number;
  hasTracker: boolean;
  hasLocalGuard: boolean;
  hasPreviewSchema: boolean;
  hasAuth: boolean;
  trackerRows: number | null;
  marker: { label: string | null; ref: string | null } | null;
  users: number | null;
  nonTestUsers: number | null;
  storedObjects: number | null;
  organizations: number | null;
  nonDemoOrganizations: number | null;
  platformRoles: number | null;
};
export type DbState = { kind: string; reason: string };
export function inspectDatabase(db: DbSession): Promise<DbFacts>;
export function journalEntries(root?: string): number;
export function classifyState(facts: DbFacts, ref: string, journal: number): DbState;
export function assertStateAllows(operation: string, state: DbState): void;
export function renderSqlFile(text: string, vars?: Record<string, string>): string;
export type SpawnResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error | undefined;
};
export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; encoding: string; timeout: number },
) => SpawnResult;
export function runMigrations(
  target: HostedDbTarget,
  options?: {
    spawn?: SpawnFn | undefined;
    log?: ((line: string) => void) | undefined;
    root?: string | undefined;
    env?: Record<string, string | undefined> | undefined;
  },
): void;
export function connectHostedDb(target: HostedDbTarget): Promise<DbSession>;
export function describeState(facts: DbFacts, state: DbState, journal: number): string[];
export function runHostedDb(
  target: HostedDbTarget,
  options?: {
    db?: DbSession | undefined;
    spawn?: SpawnFn | undefined;
    log?: ((line: string) => void) | undefined;
    root?: string | undefined;
  },
): Promise<DbState>;
