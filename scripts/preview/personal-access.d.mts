// Types of scripts/preview/personal-access.mjs (used by src/test/client-preview-personal.test.ts).
import type { PreviewTarget } from "./client-preview-target.mjs";
export class AccessLinkError extends Error {}
export function assertAppUrl(mode: "local" | "hosted", raw: string | undefined): string;
export function assertLinkFile(file: string | undefined): string;
export function createAccessLink(options: {
  target: PreviewTarget;
  svc: unknown;
  email: string | undefined;
  appUrl: string | undefined;
  linkFile: string | undefined;
  log?: ((line: string) => void) | undefined;
}): Promise<{ label: string; file: string; userId: string }>;
