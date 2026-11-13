// Types of scripts/preview/client-preview-target.mjs (used by src/test/client-preview-dataset.test.ts).
export type PreviewTarget = Readonly<{
  mode: "local" | "hosted";
  operation: string;
  where: string;
  apiUrl: string;
  serviceKey: string;
  publishableKey: string;
}>;
export function resolvePreviewTarget(
  env: Record<string, string | undefined>,
  operation: string,
): Promise<PreviewTarget>;
export function assertResolvedTarget(target: unknown): void;
export function exitOnTargetRefusal(e: unknown): never;
