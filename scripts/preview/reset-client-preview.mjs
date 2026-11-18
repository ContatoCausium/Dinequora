// Resets the fictional "Dinequora Demo Restaurant" on a checked destination only.
//
// Default: keeps the organization with its settings (brand colours and logo), its three stores (name,
// address, phone, hours, time zone, tax rate), the subscription, every member (the personal owners
// and the demo accounts), their store assignments, permission profiles and invitations, and replaces
// only the operational data (menu, stock, recipes, suppliers, purchases, expenses, sales history),
// anchored at the current time. A store whose status, zone or tax rate no longer matches the dataset
// stops the reset before anything is removed. Every person keeps their own access and password; the
// demo accounts get new passwords (credentials file).
//
// PREVIEW_TEARDOWN=1 removes everything instead (organization, demo accounts and the personal owners'
// accounts) and seeds nothing; a later seed creates the personal accounts again (new recovery links).
//
//   PREVIEW_TARGET=local|hosted PREVIEW_API_URL=… PREVIEW_SERVICE_KEY=… PREVIEW_PUBLISHABLE_KEY=… \
//   PREVIEW_PERSONAL_OWNERS=<from the secrets file> PREVIEW_CREDS_FILE=<path outside the repo> \
//   [DQ_PREVIEW_CONFIRM=client-preview:reset:client-preview:<ref>] [PREVIEW_TEARDOWN=1] \
//   node scripts/preview/reset-client-preview.mjs
//
// resolvePreviewTarget() runs the guard of the destination first; any other target is refused
// (exit 3). There is no override. The reset never touches another organization or account, and
// refuses a database holding any account outside the demo domain and the declared personal owners.
import { exitOnTargetRefusal, resolvePreviewTarget } from "./client-preview-target.mjs";

const OPERATION = "reset:client-preview";

const target = await resolvePreviewTarget(process.env, OPERATION).catch(exitOnTargetRefusal);
console.log(`client-preview guard: ${OPERATION} accepted for the ${target.where}`);
const { resetClientPreview, teardownClientPreview, SeedError } = await import("./seed-core.mjs");
try {
  if (process.env.PREVIEW_TEARDOWN === "1") await teardownClientPreview(target);
  else
    await resetClientPreview(target, {
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
