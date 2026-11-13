// Resets the fictional "Dinequora Demo Restaurant" on a checked destination only: removes the demo
// organization (public.client_preview_purge, demo organizations only) and the demo accounts
// (reserved .test domain), then seeds the same dataset again anchored at the current time, so every
// presentation starts from the same state. New passwords are written to the credentials file.
//
//   PREVIEW_TARGET=local|hosted PREVIEW_API_URL=… PREVIEW_SERVICE_KEY=… PREVIEW_PUBLISHABLE_KEY=… \
//   PREVIEW_CREDS_FILE=<path outside the repo> [DQ_PREVIEW_CONFIRM=client-preview:reset:client-preview:<ref>] \
//   [PREVIEW_PURGE_ONLY=1] node scripts/preview/reset-client-preview.mjs
//
// resolvePreviewTarget() runs the guard of the destination first; any other target is refused
// (exit 3). There is no override. The reset never touches another organization or account.
import { exitOnTargetRefusal, resolvePreviewTarget } from "./client-preview-target.mjs";

const OPERATION = "reset:client-preview";

const target = await resolvePreviewTarget(process.env, OPERATION).catch(exitOnTargetRefusal);
console.log(`client-preview guard: ${OPERATION} accepted for the ${target.where}`);
const { purgeClientPreview, seedClientPreview, SeedError } = await import("./seed-core.mjs");
try {
  await purgeClientPreview(target);
  if (process.env.PREVIEW_PURGE_ONLY !== "1")
    await seedClientPreview(target, {
      credsFile: process.env.PREVIEW_CREDS_FILE,
      profile: process.env.PREVIEW_DATASET_PROFILE ?? "ledger-safe",
    });
} catch (e) {
  if (e instanceof SeedError) {
    console.error(`reset stopped: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
