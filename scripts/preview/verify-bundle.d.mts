// Types of scripts/preview/verify-bundle.mjs (used by the client-preview and production build tests).
export const WORKER_NAME: "dinequora-client-preview";
export const PRODUCTION_WORKER_NAME: "dinequora-app";
export const PRODUCTION_DOMAIN: "app.dinequora.com";
export type DeployTarget = "client-preview" | "production";
export const TARGETS: Readonly<
  Record<
    DeployTarget,
    {
      workerName: string;
      workersDev: boolean;
      routes: { pattern: string; custom_domain: boolean }[] | undefined;
      profile: string;
      serverOnlyNames?: string[];
    }
  >
>;
export type BundleFinding = { file: string; message: string };
export type BundleReport = {
  errors: BundleFinding[];
  warnings: BundleFinding[];
  stats: { files: number };
};
export function scanBundle(
  outputDir: string,
  expected: {
    expectedSupabaseUrl: string | undefined;
    expectedPublishableKey: string | undefined;
    deny?: string[] | undefined;
    target?: DeployTarget | undefined;
  },
): BundleReport;
export function printReport(
  report: BundleReport,
  log?: (line: string) => void,
  target?: DeployTarget,
): void;
