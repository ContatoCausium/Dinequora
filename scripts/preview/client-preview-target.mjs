// The ONLY way the client-preview dataset scripts obtain a destination they may write to.
//
//   PREVIEW_TARGET=local   a local DISPOSABLE rehearsal stack (scripts/preview/supabase): the existing
//                          target guard (scripts/guard/target-guard.mjs) must accept the API — loopback
//                          host, database marked disposable by `claim`, protected clusters refused.
//   PREVIEW_TARGET=hosted  the hosted client-preview project: scripts/preview/preview-target.mjs must
//                          accept it — hosted origin, operator confirmation, server key of that
//                          project, client-preview marker with the same ref, no real data.
//
// Anything else is refused. There is no override. The returned target is branded: code that writes
// (scripts/preview/seed-core.mjs) calls assertResolvedTarget() before creating any client, so a
// hand-built object can never stand in for a checked destination. Keys are never printed.
import { assertDisposableApi, GuardRefusal } from "../guard/target-guard.mjs";
import { assertClientPreviewApi, PREVIEW_OPERATIONS, PreviewRefusal } from "./preview-target.mjs";
import { parsePersonalOwners, PersonalOwnersError } from "./personal-owners.mjs";

const BRAND = Symbol("client-preview-target");

export async function resolvePreviewTarget(env, operation) {
  if (!PREVIEW_OPERATIONS.includes(operation)) throw new PreviewRefusal("unknown operation");
  const mode = env.PREVIEW_TARGET;
  const apiUrl = env.PREVIEW_API_URL;
  const serviceKey = env.PREVIEW_SERVICE_KEY;
  const publishableKey = env.PREVIEW_PUBLISHABLE_KEY;
  if (mode !== "local" && mode !== "hosted")
    throw new PreviewRefusal(
      "PREVIEW_TARGET must be local (disposable stack) or hosted (client preview)",
    );
  if (typeof publishableKey !== "string" || publishableKey.length < 20)
    throw new PreviewRefusal("missing publishable key (PREVIEW_PUBLISHABLE_KEY)");
  // The personal owners (at most two): real people on the hosted preview, where they must also equal
  // the list fixed in its marker; stand-in .test addresses on a local stack (never real people).
  let personalOwners;
  try {
    personalOwners = parsePersonalOwners(env.PREVIEW_PERSONAL_OWNERS, { mode });
  } catch (e) {
    throw new PreviewRefusal(
      e instanceof PersonalOwnersError ? e.message : "invalid personal owners",
    );
  }
  let where;
  if (mode === "local") {
    const cluster = await assertDisposableApi(apiUrl, serviceKey, operation);
    where = `local disposable stack (cluster ${cluster})`;
  } else {
    const { ref } = await assertClientPreviewApi({
      apiUrl,
      serviceKey,
      operation,
      confirm: env.DQ_PREVIEW_CONFIRM,
      personalOwners,
    });
    where = `hosted client-preview project ${ref}`;
  }
  return Object.freeze({
    [BRAND]: true,
    mode,
    operation,
    where,
    apiUrl: String(apiUrl).replace(/\/+$/, ""),
    serviceKey,
    publishableKey,
    personalOwners,
  });
}

export function assertResolvedTarget(target) {
  if (!target || target[BRAND] !== true || !PREVIEW_OPERATIONS.includes(target.operation))
    throw new PreviewRefusal("not a destination checked by resolvePreviewTarget");
}

/** For scripts: a refusal of either guard ends the process with exit 3 and its message only. */
export function exitOnTargetRefusal(e) {
  if (e instanceof PreviewRefusal || e instanceof GuardRefusal) {
    console.error(e.message);
    process.exit(3);
  }
  throw e;
}
