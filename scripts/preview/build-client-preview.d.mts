// Types of scripts/preview/build-client-preview.mjs (used by src/test/client-preview-build.test.ts).
export const PREVIEW_MODE: "client-preview";
export const PREVIEW_ENV_FILE: ".env.client-preview.local";
export const LOADED_ENV_FILES: string[];
export const ROBOTS_TXT: string;
export const ASSET_HEADERS: string;
export class BuildRefusal extends Error {}
export function parseEnvFile(text: string): Record<string, string>;
export function validatePreviewBuildEnv(
  values: Record<string, string>,
  options?: { placeholder?: boolean | undefined; expectRef?: string | undefined },
): { url: string; key: string; ref: string | null };
export function assertCleanBuildContext(
  root: string,
  env: Record<string, string | undefined>,
): void;
export function hardenOutput(outputDir: string): void;
