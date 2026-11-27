// Seeds the fictional "Dinequora Demo Restaurant" (scripts/preview/dataset.mjs) on a checked
// destination only: a local disposable rehearsal stack or the hosted client-preview project.
//
// Local rehearsal (repo root; keys from `supabase status --workdir scripts/preview -o env`):
//   PREVIEW_TARGET=local PREVIEW_API_URL=http://127.0.0.1:64731 PREVIEW_SERVICE_KEY=<service key> \
//   PREVIEW_PUBLISHABLE_KEY=<anon/publishable key> PREVIEW_CREDS_FILE=<path outside the repo> \
//   node scripts/preview/seed-client-preview.mjs
//
// Hosted client preview (values from a file outside the repo, never from the command line):
//   PREVIEW_TARGET=hosted PREVIEW_API_URL=https://<ref>.supabase.co PREVIEW_SERVICE_KEY=<secret key> \
//   PREVIEW_PUBLISHABLE_KEY=<publishable key> DQ_PREVIEW_CONFIRM=client-preview:seed:client-preview:<ref> \
//   PREVIEW_CREDS_FILE=<path outside the repo> node scripts/preview/seed-client-preview.mjs
//
// Before anything else resolvePreviewTarget() runs the guard of that destination (target guard for
// local stacks, client-preview guard for the hosted project); any other target — production, the
// QA, the local demo, an unmarked copy — is refused (exit 3). There is no override. Requires
// scripts/preview/sql/client-preview-functions.sql on the destination. Refuses when the demo
// organization or demo accounts already exist (use reset).
import { exitOnTargetRefusal, resolvePreviewTarget } from "./client-preview-target.mjs";

const OPERATION = "seed:client-preview";

const target = await resolvePreviewTarget(process.env, OPERATION).catch(exitOnTargetRefusal);
console.log(`client-preview guard: ${OPERATION} accepted for the ${target.where}`);
const { seedClientPreview, SeedError } = await import("./seed-core.mjs");
try {
  await seedClientPreview(target, {
    credsFile: process.env.PREVIEW_CREDS_FILE,
    profile: process.env.PREVIEW_DATASET_PROFILE ?? "ledger-safe",
  });
} catch (e) {
  if (e instanceof SeedError) {
    console.error(`seed stopped: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
