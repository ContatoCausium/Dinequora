// Types of scripts/preview/personal-owners.mjs (used by src/test/client-preview-personal.test.ts).
export const MAX_PERSONAL_OWNERS: number;
export class PersonalOwnersError extends Error {}
export function isReservedTestEmail(email: string | undefined): boolean;
export function parsePersonalOwners(
  raw: string | undefined,
  options?: { mode?: "hosted" | "local" | undefined },
): readonly string[];
export function sameOwners(a: readonly string[], b: readonly string[]): boolean;
export function personalLabel(owners: readonly string[], email: string): string;
export function parsePersonalOwnerNames(
  rawOwners: string | undefined,
  rawNames: string | undefined,
): Readonly<Record<string, string>>;
