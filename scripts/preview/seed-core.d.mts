// Types of scripts/preview/seed-core.mjs (used by src/test/client-preview-*.test.ts).
import type { PreviewTarget } from "./client-preview-target.mjs";
export class SeedError extends Error {}
export function assertCredsFileOutsideRepo(file: string | undefined): string;
type RunOptions = {
  now?: number | undefined;
  profile?: "ledger-safe" | "full" | "presentation" | undefined;
  credsFile?: string | undefined;
  log?: ((line: string) => void) | undefined;
  concurrency?: number | undefined;
};
type RunResult = {
  orgId: string;
  slug: string;
  stores: Record<string, string>;
  credsPath: string;
  personalOwners: { label: string; userId: string; state: string }[];
};
export function seedClientPreview(target: PreviewTarget, options?: RunOptions): Promise<RunResult>;
export function resetClientPreview(target: PreviewTarget, options?: RunOptions): Promise<RunResult>;
export function teardownClientPreview(
  target: PreviewTarget,
  options?: { log?: ((line: string) => void) | undefined },
): Promise<{ organizations: unknown[]; demoAccounts: number; personalAccounts: number }>;
