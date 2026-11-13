// Resets the fictional "Dinequora Demo Restaurant" on the hosted CLIENT PREVIEW project only
// (removes it and recreates it from the deterministic dataset, so every presentation starts equal).
//
// Usage (repo root; values from a file outside the repo, never from the command line):
//   PREVIEW_API_URL=https://<ref>.supabase.co PREVIEW_SERVICE_KEY=<secret key of that project> \
//   DQ_PREVIEW_CONFIRM=client-preview:reset:client-preview:<ref> node scripts/preview/reset-client-preview.mjs
//
// The client-preview guard (scripts/preview/preview-target.mjs) runs first and refuses any
// destination that is not the marked client-preview project holding no real data; there is no
// override. The reset will only ever touch the preview's demo organization.
//
// Stage 2 of the client-preview plan delivers the guard only: after a successful check this script
// stops without deleting or writing anything (the reset steps need their own authorization).
import {
  assertClientPreviewApi,
  exitOnPreviewRefusal,
  previewTargetFromEnv,
} from "./preview-target.mjs";

const OPERATION = "reset:client-preview";

const target = await assertClientPreviewApi(previewTargetFromEnv(process.env, OPERATION)).catch(
  exitOnPreviewRefusal,
);
console.log(`client-preview guard: ${OPERATION} accepted for project ${target.ref}`);
console.error(
  "the client-preview reset is not implemented in this stage; nothing was deleted or written (needs its own authorization)",
);
process.exit(4);
