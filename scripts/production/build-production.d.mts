// Types of scripts/production/build-production.mjs (used by src/test/production-build.test.ts).
export const PRODUCTION_MODE: "production";
export const PRODUCTION_ENV_FILE: ".env.production.local";
export const PRODUCTION_LOADED_ENV_FILES: string[];
export class ProductionBuildRefusal extends Error {}
export function validateProductionBuildEnv(
  values: Record<string, string>,
  options?: { expectRef?: string | undefined },
): { url: string; key: string; ref: string };
export function assertCleanProductionContext(
  root: string,
  env: Record<string, string | undefined>,
): void;
export function hardenProductionOutput(outputDir: string): void;
