// Types of scripts/guard/target-guard.mjs (used by the database integration tests in src/test).
export class GuardRefusal extends Error {}
export function clusterHash(systemIdentifier: string): string;
export function short(hash: string): string;
export function protectedLabel(hash: string): string | null;
export function describeDbUrl(dbUrl: string | undefined): { where: string; url: URL };
export function describeApiUrl(apiUrl: string | undefined): string;
export function assertDisposableDb(
  dbUrl: string | undefined,
  operation: string,
  options?: { newEmpty?: boolean },
): Promise<string>;
export function exitOnRefusal(e: unknown): never;
export function assertDisposableApi(
  apiUrl: string | undefined,
  serviceKey: string | undefined,
  operation: string,
): Promise<string>;
