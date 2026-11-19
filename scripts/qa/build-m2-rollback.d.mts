// Types of scripts/qa/build-m2-rollback.mjs (used by src/test/m2-rollback-files.test.ts).
export function buildM2RollbackFiles(): { rollback: string; reapply: string };
export function buildSecurityClosureRollbackFiles(): {
  "0034-rollback": string;
  "0035-rollback": string;
};
