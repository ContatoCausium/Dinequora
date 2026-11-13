// Types of scripts/preview/verify-bundle.mjs (used by src/test/client-preview-build.test.ts).
export const WORKER_NAME: "dinequora-client-preview";
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
  },
): BundleReport;
export function printReport(report: BundleReport, log?: (line: string) => void): void;
