// Seeds the fictional "Dinequora Demo Restaurant" on the hosted CLIENT PREVIEW project only.
//
// Usage (repo root; values from a file outside the repo, never from the command line):
//   PREVIEW_API_URL=https://<ref>.supabase.co PREVIEW_SERVICE_KEY=<secret key of that project> \
//   DQ_PREVIEW_CONFIRM=client-preview:seed:client-preview:<ref> node scripts/preview/seed-client-preview.mjs
//
// Before anything else the client-preview guard (scripts/preview/preview-target.mjs) must accept the
// destination: hosted project origin, operator confirmation for this operation and project, a server
// key of that project, the client-preview marker with the same ref, and no real data. Any other
// target (production, the QA, the local demo, a copy) is refused; there is no override.
//
// Stage 2 of the client-preview plan delivers the guard only. The dataset (organization, the
// Downtown / Westside / Airport stores, menu, stock, recipes, sales history) is a separate,
// separately authorized step: after a successful check this script stops without writing.
import {
  assertClientPreviewApi,
  exitOnPreviewRefusal,
  previewTargetFromEnv,
} from "./preview-target.mjs";

const OPERATION = "seed:client-preview";

const target = await assertClientPreviewApi(previewTargetFromEnv(process.env, OPERATION)).catch(
  exitOnPreviewRefusal,
);
console.log(`client-preview guard: ${OPERATION} accepted for project ${target.ref}`);
console.error(
  "the client-preview dataset is not implemented in this stage; nothing was written (needs its own authorization)",
);
process.exit(4);
