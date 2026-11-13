// Types of scripts/preview/seed-core.mjs (used by src/test/client-preview-dataset.test.ts).
import type { PreviewTarget } from "./client-preview-target.mjs";
export class SeedError extends Error {}
export function assertCredsFileOutsideRepo(file: string | undefined): string;
export function seedClientPreview(
  target: PreviewTarget,
  options?: {
    now?: number | undefined;
    profile?: "ledger-safe" | "full" | undefined;
    credsFile?: string | undefined;
    log?: ((line: string) => void) | undefined;
    concurrency?: number | undefined;
  },
): Promise<{ orgId: string; slug: string; stores: Record<string, string>; credsPath: string }>;
export function purgeClientPreview(
  target: PreviewTarget,
  options?: { log?: ((line: string) => void) | undefined },
): Promise<{ organizations: unknown[]; accounts: number }>;
