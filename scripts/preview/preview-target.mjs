// Client-preview target guard: the ONLY way a script may write to the hosted client-preview database
// (seed and reset). Deny by default; every check below must pass, and there is no override switch.
//
// A destination is the client preview only when ALL of these hold:
//   1. the operation is one of PREVIEW_OPERATIONS;
//   2. the API URL is exactly https://<ref>.supabase.co (no credentials, port, path or query); local
//      and private hosts are refused here (local stacks go through scripts/guard/target-guard.mjs);
//   3. the operator confirmation names this operation and this project for the session:
//      DQ_PREVIEW_CONFIRM=client-preview:<operation>:<ref> (the expected value is never printed);
//   4. the key is a server key of THIS project: an `sb_secret_…` key, or a legacy service_role JWT
//      whose `ref` claim is <ref>; publishable/anon keys are refused;
//   5. the database answers public.client_preview_identity() (created only by
//      scripts/preview/sql/client-preview-identity.sql, executable by service_role only) with the
//      client-preview label, marker version 1 and the SAME project ref, which the database stored
//      when it was marked (a marker restored or copied to another project does not match);
//   6. the database holds no real data: 0 non-demo organizations, 0 accounts outside the reserved test
//      domains (.test/.example/.invalid) and 0 platform roles. Production fails here even if marked.
// A missing answer, a failed request or any unexpected value is a refusal. Keys are never printed.
import { Buffer } from "node:buffer";

export const PREVIEW_LABEL = "client-preview";
export const PREVIEW_MARKER_VERSION = 1;
export const PREVIEW_OPERATIONS = Object.freeze(["seed:client-preview", "reset:client-preview"]);

const REF = /^[a-z0-9]{20}$/;
const HOST = /^([a-z0-9]{20})\.supabase\.co$/;
const LOCAL_HOST =
  /^(localhost|.*\.localhost|127(\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|host\.docker\.internal)$/;

export class PreviewRefusal extends Error {
  constructor(message) {
    super(`refused by the client-preview guard: ${message}`);
    this.name = "PreviewRefusal";
  }
}

/** For scripts: a refusal ends the process with exit 3 and its message only (no stack trace). */
export function exitOnPreviewRefusal(e) {
  if (e instanceof PreviewRefusal) {
    console.error(e.message);
    process.exit(3);
  }
  throw e;
}

export function assertPreviewOperation(operation) {
  if (!PREVIEW_OPERATIONS.includes(operation))
    throw new PreviewRefusal(`unknown operation (allowed: ${PREVIEW_OPERATIONS.join(", ")})`);
}

/** Validates the API URL and returns the project ref and canonical origin. */
export function parsePreviewApiUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    throw new PreviewRefusal("missing or unreadable API URL");
  }
  const host = u.hostname.toLowerCase();
  if (LOCAL_HOST.test(host))
    throw new PreviewRefusal(
      `local or private host ${host}: the client-preview guard only accepts the hosted project (local stacks use scripts/guard/target-guard.mjs)`,
    );
  if (u.protocol !== "https:") throw new PreviewRefusal("the API URL must use https");
  if (u.username || u.password) throw new PreviewRefusal("the API URL must not carry credentials");
  if (u.port && u.port !== "443") throw new PreviewRefusal("the API URL must not set a port");
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash)
    throw new PreviewRefusal("the API URL must be the project origin only (no path or query)");
  const m = HOST.exec(host);
  if (!m) throw new PreviewRefusal(`${host} is not a Supabase project host (<ref>.supabase.co)`);
  return { ref: m[1], origin: `https://${m[1]}.supabase.co` };
}

export function assertPreviewConfirmation(operation, ref, confirm) {
  if (!REF.test(String(ref))) throw new PreviewRefusal("invalid project ref");
  if (typeof confirm !== "string" || confirm !== `client-preview:${operation}:${ref}`)
    throw new PreviewRefusal(
      `${operation} on project ${ref} needs the operator confirmation for this operation and this project (DQ_PREVIEW_CONFIRM, see docs/operations/client-preview.md)`,
    );
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Accepts only a server key of this project. Returns the key kind; never returns or prints the key. */
export function inspectServiceKey(key, ref) {
  if (typeof key !== "string" || key.trim() === "")
    throw new PreviewRefusal("missing server key (PREVIEW_SERVICE_KEY)");
  if (key.startsWith("sb_publishable_"))
    throw new PreviewRefusal(
      "a publishable key cannot run seed or reset; use the project's secret key",
    );
  if (key.startsWith("sb_secret_")) {
    if (key.length < 24) throw new PreviewRefusal("malformed secret key");
    return "secret";
  }
  const payload = decodeJwtPayload(key);
  if (!payload) throw new PreviewRefusal("unrecognized key format");
  if (payload.role !== "service_role")
    throw new PreviewRefusal(`the key role is ${String(payload.role)}, not service_role`);
  if (payload.ref !== ref) throw new PreviewRefusal("the key belongs to another project");
  return "service_role_jwt";
}

/** Validates the identity document returned by public.client_preview_identity(). */
export function assertPreviewIdentity(identity, ref) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity))
    throw new PreviewRefusal("the database returned no client-preview identity");
  if (identity.label !== PREVIEW_LABEL)
    throw new PreviewRefusal("the database is not marked as the client preview");
  if (identity.marker_version !== PREVIEW_MARKER_VERSION)
    throw new PreviewRefusal("unsupported client-preview marker version");
  if (identity.project_ref !== ref)
    throw new PreviewRefusal(
      "the marker was created for another project (a copied or restored database is never the preview)",
    );
  for (const [field, what] of [
    ["non_demo_organizations", "non-demo organizations"],
    ["non_test_users", "accounts outside the reserved test domains"],
    ["platform_roles", "platform roles"],
  ]) {
    const n = identity[field];
    if (typeof n !== "number" || !Number.isInteger(n))
      throw new PreviewRefusal(`the identity has no ${field} count`);
    if (n !== 0) throw new PreviewRefusal(`the database has ${n} ${what}: it holds real data`);
  }
}

/**
 * The full check, through the API the caller writes with. Resolves to { ref, keyKind } only when the
 * destination is the client preview; otherwise rejects with PreviewRefusal.
 */
export async function assertClientPreviewApi({
  apiUrl,
  serviceKey,
  operation,
  confirm,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
}) {
  assertPreviewOperation(operation);
  const { ref, origin } = parsePreviewApiUrl(apiUrl);
  assertPreviewConfirmation(operation, ref, confirm);
  const keyKind = inspectServiceKey(serviceKey, ref);
  const headers = { apikey: serviceKey, "content-type": "application/json" };
  // New-format keys are not JWTs and must not be sent as a bearer token.
  if (keyKind === "service_role_jwt") headers.authorization = `Bearer ${serviceKey}`;
  let res;
  try {
    res = await fetchImpl(`${origin}/rest/v1/rpc/client_preview_identity`, {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new PreviewRefusal(
      `cannot reach project ${ref}: ${String(e?.cause?.code ?? e?.name ?? "error").slice(0, 80)}`,
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new PreviewRefusal(
      `project ${ref} is not marked as the client preview (${res.status} ${String(body?.code ?? "").slice(0, 40)})`,
    );
  assertPreviewIdentity(body, ref);
  return { ref, keyKind };
}

/** Reads the destination from the environment (never from the command line). */
export function previewTargetFromEnv(env, operation) {
  return {
    apiUrl: env.PREVIEW_API_URL,
    serviceKey: env.PREVIEW_SERVICE_KEY,
    confirm: env.DQ_PREVIEW_CONFIRM,
    operation,
  };
}
