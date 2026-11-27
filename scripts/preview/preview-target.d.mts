// Types of scripts/preview/preview-target.mjs (used by src/test/client-preview-*.test.ts).
export const PREVIEW_LABEL: "client-preview";
export const PREVIEW_MARKER_VERSION: 2;
export const PREVIEW_OPERATIONS: readonly [
  "seed:client-preview",
  "reset:client-preview",
  "verify:client-preview",
  "access:client-preview",
];
export class PreviewRefusal extends Error {}
export function exitOnPreviewRefusal(e: unknown): never;
export function assertPreviewOperation(operation: string): void;
export function parsePreviewApiUrl(raw: unknown): { ref: string; origin: string };
export function assertPreviewConfirmation(
  operation: string,
  ref: string,
  confirm: string | undefined,
): void;
export function inspectServiceKey(key: unknown, ref: string): "secret" | "service_role_jwt";
export function assertPreviewIdentity(
  identity: unknown,
  ref: string,
  personalOwners?: readonly string[],
): void;
export function assertClientPreviewApi(target: {
  apiUrl: string | undefined;
  serviceKey: string | undefined;
  operation: string;
  confirm: string | undefined;
  personalOwners?: readonly string[] | undefined;
  fetchImpl?: ((input: string, init: RequestInit) => Promise<Response>) | undefined;
  timeoutMs?: number | undefined;
}): Promise<{ ref: string; keyKind: "secret" | "service_role_jwt" }>;
export function previewTargetFromEnv(
  env: Record<string, string | undefined>,
  operation: string,
): {
  apiUrl: string | undefined;
  serviceKey: string | undefined;
  confirm: string | undefined;
  operation: string;
};
