// Writes an individual password-recovery link for ONE personal owner (scripts/preview/personal-access.mjs).
//
//   PREVIEW_TARGET=local|hosted PREVIEW_API_URL=… PREVIEW_SERVICE_KEY=… PREVIEW_PUBLISHABLE_KEY=… \
//   PREVIEW_PERSONAL_OWNERS=<from the secrets file> PREVIEW_ACCESS_EMAIL=<one of them> \
//   PREVIEW_APP_URL=<preview app origin> PREVIEW_LINK_FILE=<new file outside the repo> \
//   [DQ_PREVIEW_CONFIRM=client-preview:access:client-preview:<ref>] node scripts/preview/personal-access-link.mjs
//
// resolvePreviewTarget() runs the guard of the destination first (exit 3 when refused). The link is
// written only to PREVIEW_LINK_FILE; nothing secret is printed.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exitOnTargetRefusal, resolvePreviewTarget } from "./client-preview-target.mjs";

const OPERATION = "access:client-preview";

const target = await resolvePreviewTarget(process.env, OPERATION).catch(exitOnTargetRefusal);
console.log(`client-preview guard: ${OPERATION} accepted for the ${target.where}`);
const { AccessLinkError, createAccessLink } = await import("./personal-access.mjs");
const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"),
);
const { createClient } = require("@supabase/supabase-js");
const svc = createClient(target.apiUrl, target.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
try {
  await createAccessLink({
    target,
    svc,
    email: process.env.PREVIEW_ACCESS_EMAIL,
    appUrl: process.env.PREVIEW_APP_URL,
    linkFile: process.env.PREVIEW_LINK_FILE,
  });
} catch (e) {
  if (e instanceof AccessLinkError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
