// Verifies a client-preview build (.output) before it can be published: the bundle must point only at
// the expected Supabase project, carry no credential beyond that project's publishable key, and hold
// no reference to local stacks (QA, demo, CI), connection strings or the production project.
//
// Findings never include the value that matched (only its kind and the file), so the report is safe
// to paste anywhere.
//
// CLI (exit 0 = clean, 1 = errors found, 2 = usage):
//   PREVIEW_EXPECTED_SUPABASE_URL=https://<ref>.supabase.co PREVIEW_EXPECTED_PUBLISHABLE_KEY=<key> \
//   [PREVIEW_BUNDLE_DENY=<comma-separated strings that must never appear, e.g. other project refs>] \
//   node scripts/preview/verify-bundle.mjs [--output .output]
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

export const WORKER_NAME = "dinequora-client-preview";
const TEXT =
  /\.(mjs|js|cjs|json|html|css|txt|svg|webmanifest|map)$|(^|[\\/])_headers$|(^|[\\/])_redirects$/;

// Library constants that are not backends of this app: supabase-js GoTrue default (localhost:9999),
// Lovable auth helpers (localhost:3000, 127.0.0.1 OAuth callback) and the TanStack Router origin
// fallback when there is no window.origin (http://localhost, no port). Matched exactly against
// scheme + host + port, so any other port (e.g. a local Supabase stack) is still an error.
const ALLOWED_LOCAL_URLS = new Set([
  "http://localhost:9999",
  "http://localhost:3000",
  "http://127.0.0.1",
  "http://localhost",
]);
const LOCAL_URL =
  /\b(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{1,5})?/g;
const DB_URL = /\bpostgres(?:ql)?:\/\/[^\s"'`]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SECRET_KEY = /\bsb_secret_[A-Za-z0-9_-]{8,}/g;
const PUBLISHABLE_KEY = /\bsb_publishable_[A-Za-z0-9_-]{8,}/g;
const SUPABASE_HOST = /\b([a-z0-9]{20})\.supabase\.(?:co|in)\b/g;
// Local stacks, environments and server-only names that must never be bundled.
const FORBIDDEN = [
  ["ilemvaquootxarmisdjb", "id of the local commercial demo stack"],
  ["dq-rebuild", "name of the persistent QA stack"],
  ["dinequora-production", "name of the production project"],
  ["SUPABASE_SERVICE_ROLE_KEY", "service-role client (must never be bundled)"],
  ["LOVABLE_CRON_SECRET", "cron secret reader"],
  ["RESEND_API_KEY", "e-mail provider key reader"],
  ["STRIPE_SECRET", "payment provider key reader"],
];
const ABSOLUTE_PATH =
  /(?:\b[A-Za-z]:[\\/]{1,2}(?:Users|dev|home)[\\/]|\/(?:home|Users)\/[A-Za-z0-9._-]+\/)/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function jwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function refOf(url) {
  try {
    return /^([a-z0-9]{20})\.supabase\.co$/.exec(new URL(url).hostname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Scans a build output directory. Returns { errors, warnings, stats }; each finding is
 * { file, message } with paths relative to the output directory.
 */
export function scanBundle(outputDir, { expectedSupabaseUrl, expectedPublishableKey, deny = [] }) {
  const errors = [];
  const warnings = [];
  const err = (file, message) => errors.push({ file, message });
  const warn = (file, message) => warnings.push({ file, message });
  const root = path.resolve(outputDir);
  const rel = (p) => path.relative(root, p).split(path.sep).join("/");

  if (!expectedSupabaseUrl || !expectedPublishableKey) {
    err(".", "expected Supabase URL and publishable key are required");
    return { errors, warnings, stats: { files: 0 } };
  }
  const expectedRef = refOf(expectedSupabaseUrl);
  const expectedHost = (() => {
    try {
      return new URL(expectedSupabaseUrl).hostname;
    } catch {
      return null;
    }
  })();
  const denyList = deny.map((d) => String(d).trim()).filter((d) => d.length >= 8);

  for (const required of ["server/index.mjs", "server/wrangler.json", "public", "nitro.json"])
    if (!fs.existsSync(path.join(root, required))) err(required, "missing from the build output");
  if (errors.length) return { errors, warnings, stats: { files: 0 } };

  const nitro = JSON.parse(fs.readFileSync(path.join(root, "nitro.json"), "utf8"));
  if (nitro.preset !== "cloudflare-module")
    err("nitro.json", `preset is ${String(nitro.preset)}, expected cloudflare-module`);
  const wrangler = JSON.parse(fs.readFileSync(path.join(root, "server/wrangler.json"), "utf8"));
  if (wrangler.name !== WORKER_NAME)
    err("server/wrangler.json", `worker name is ${String(wrangler.name)}, expected ${WORKER_NAME}`);
  if (!(wrangler.compatibility_flags ?? []).includes("nodejs_compat"))
    err("server/wrangler.json", "nodejs_compat flag missing");
  // Version preview URLs bypass the Cloudflare Access application of the workers.dev URL, and
  // wrangler enables them on deploy unless the config says otherwise.
  if (wrangler.preview_urls !== false)
    err(
      "server/wrangler.json",
      "preview_urls must be false (preview URLs bypass Cloudflare Access)",
    );
  if (wrangler.workers_dev !== true)
    err("server/wrangler.json", "workers_dev must be true (the preview is served on workers.dev)");
  for (const key of ["routes", "route", "custom_domains"])
    if (wrangler[key] !== undefined)
      err("server/wrangler.json", `unexpected ${key} (the preview is served on workers.dev only)`);
  for (const key of ["vars", "secrets", "d1_databases", "kv_namespaces", "r2_buckets"])
    if (wrangler[key] !== undefined)
      err(
        "server/wrangler.json",
        `unexpected ${key} section (configuration belongs to the Worker settings)`,
      );

  const files = walk(root);
  let urlInClient = false;
  let urlInServer = false;
  let keyInClient = false;
  let profileInClient = false;
  let profileInServer = false;

  for (const file of files) {
    const r = rel(file);
    const inServer = r.startsWith("server/");
    const inPublic = r.startsWith("public/");
    if (r.split("/").includes(".wrangler")) {
      err(r, "local wrangler state inside the build output (rebuild from clean)");
      continue;
    }
    if (r.endsWith(".map")) err(r, "source map in the build output");
    if (!TEXT.test(r)) continue;
    const text = fs.readFileSync(file, "utf8");

    for (const m of text.match(JWT) ?? []) {
      const payload = jwtPayload(m);
      if (!payload) continue;
      if (payload.role !== "anon") err(r, `JWT with role ${String(payload.role)}`);
      else if (m !== expectedPublishableKey)
        err(r, "anon key that is not the expected publishable key");
    }
    if (SECRET_KEY.test(text)) err(r, "Supabase secret key (sb_secret_…)");
    SECRET_KEY.lastIndex = 0;
    for (const m of text.match(PUBLISHABLE_KEY) ?? [])
      if (m !== expectedPublishableKey) err(r, "publishable key of another project");
    for (const m of text.matchAll(SUPABASE_HOST))
      if (m[1] !== expectedRef) err(r, "reference to another Supabase project");
    for (const m of text.match(LOCAL_URL) ?? [])
      if (!ALLOWED_LOCAL_URLS.has(m)) err(r, "local or private backend URL");
    if (DB_URL.test(text)) err(r, "database connection string");
    DB_URL.lastIndex = 0;
    for (const [needle, what] of FORBIDDEN) if (text.includes(needle)) err(r, what);
    denyList.forEach((needle, i) => {
      if (text.includes(needle)) err(r, `denied string #${i + 1} (PREVIEW_BUNDLE_DENY)`);
    });
    if (ABSOLUTE_PATH.test(text)) {
      if (inPublic) err(r, "absolute build-machine path in a public file");
      else warn(r, "absolute build-machine path (server-side manifest only, not served)");
    }

    const hasUrl = expectedHost !== null && text.includes(expectedHost);
    const hasProfile = text.includes('"client-preview"') || text.includes("`client-preview`");
    if (inPublic) {
      urlInClient ||= hasUrl;
      keyInClient ||= text.includes(expectedPublishableKey);
      profileInClient ||= hasProfile;
    }
    if (inServer) {
      urlInServer ||= hasUrl;
      profileInServer ||= hasProfile;
    }
  }

  if (!urlInClient) err("public", "the expected Supabase URL is not in the browser bundle");
  if (!urlInServer) err("server", "the expected Supabase URL is not in the server bundle");
  if (!keyInClient) err("public", "the expected publishable key is not in the browser bundle");
  if (!profileInClient)
    err("public", "the browser bundle was not built with the client-preview profile");
  if (!profileInServer)
    err("server", "the server bundle was not built with the client-preview profile");

  const robots = path.join(root, "public/robots.txt");
  if (
    !fs.existsSync(robots) ||
    !/^User-agent: \*\s*\nDisallow: \/\s*$/m.test(fs.readFileSync(robots, "utf8"))
  )
    err("public/robots.txt", "must disallow every crawler");
  const headers = path.join(root, "public/_headers");
  if (
    !fs.existsSync(headers) ||
    !/^\/\*\s*\n(?:[ \t]+.*\n)*?[ \t]+X-Robots-Tag: noindex/m.test(fs.readFileSync(headers, "utf8"))
  )
    err("public/_headers", "static assets must carry X-Robots-Tag: noindex");

  return { errors, warnings, stats: { files: files.length } };
}

export function printReport({ errors, warnings, stats }, log = console.log) {
  log(
    `client-preview bundle check: ${stats.files} files, ${errors.length} errors, ${warnings.length} warnings`,
  );
  for (const e of errors) log(`  ERROR   ${e.file}: ${e.message}`);
  for (const w of warnings) log(`  warning ${w.file}: ${w.message}`);
}

async function main(argv) {
  const i = argv.indexOf("--output");
  const output = i >= 0 ? argv[i + 1] : ".output";
  if (!output) {
    console.error("usage: node scripts/preview/verify-bundle.mjs [--output DIR]");
    process.exit(2);
  }
  const result = scanBundle(output, {
    expectedSupabaseUrl: process.env.PREVIEW_EXPECTED_SUPABASE_URL,
    expectedPublishableKey: process.env.PREVIEW_EXPECTED_PUBLISHABLE_KEY,
    deny: (process.env.PREVIEW_BUNDLE_DENY ?? "").split(","),
  });
  printReport(result);
  process.exit(result.errors.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
