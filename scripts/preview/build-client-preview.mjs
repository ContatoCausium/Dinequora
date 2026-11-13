// Builds the CLIENT PREVIEW (Cloudflare Workers, preset cloudflare-module) from this checkout.
//
//   node scripts/preview/build-client-preview.mjs --expect-ref <20-character project ref>
//   node scripts/preview/build-client-preview.mjs --placeholder      # build test, no real project
//
// Values come ONLY from .env.client-preview.local (git-ignored; public values only):
//   VITE_SUPABASE_URL=https://<ref>.supabase.co
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…          (never a secret/service-role key)
//   VITE_AUTH_SOCIAL_PROVIDERS=                             (must stay empty)
//   VITE_SUPPORT_EMAIL=                                     (optional)
// The profile VITE_DEPLOYMENT_PROFILE=client-preview is forced by this script.
//
// Refuses before building when: .env or .env.local exist (Vite would load them in every mode, e.g.
// the QA URL of a local checkout), the shell exports VITE_*/SUPABASE_*/NITRO_*/LOVABLE_* variables
// (they would override the file), the file has other keys, the URL is not the expected hosted project,
// or the key is not a publishable key of that project. After the build it writes the no-index
// robots.txt and static-asset headers, names the Worker, and runs scripts/preview/verify-bundle.mjs.
// Nothing is deployed.
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { printReport, scanBundle, WORKER_NAME } from "./verify-bundle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PREVIEW_MODE = "client-preview";
export const PREVIEW_ENV_FILE = ".env.client-preview.local";
// Loaded by Vite in this mode besides PREVIEW_ENV_FILE; values must come from PREVIEW_ENV_FILE only.
export const LOADED_ENV_FILES = [".env", ".env.local", ".env.client-preview"];
const ALLOWED_KEYS = new Set([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_AUTH_SOCIAL_PROVIDERS",
  "VITE_SUPPORT_EMAIL",
  "VITE_DEPLOYMENT_PROFILE",
]);
const SHELL_OVERRIDES = /^(VITE_|SUPABASE_|NITRO_|SERVER_PRESET$|LOVABLE_)/;

export const ROBOTS_TXT = "User-agent: *\nDisallow: /\n";
export const ASSET_HEADERS = [
  "/*",
  "  X-Robots-Tag: noindex, nofollow, noarchive",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  X-Frame-Options: DENY",
  "",
].join("\n");

export class BuildRefusal extends Error {
  constructor(message) {
    super(`client-preview build refused: ${message}`);
    this.name = "BuildRefusal";
  }
}

export function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) throw new BuildRefusal(`unreadable line in ${PREVIEW_ENV_FILE}`);
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function jwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Pure validation of the preview build values. Returns the normalized values. */
export function validatePreviewBuildEnv(values, { placeholder = false, expectRef } = {}) {
  for (const key of Object.keys(values))
    if (!ALLOWED_KEYS.has(key))
      throw new BuildRefusal(
        `${PREVIEW_ENV_FILE} may only hold public build values (unexpected ${key})`,
      );
  const profile = values.VITE_DEPLOYMENT_PROFILE;
  if (profile !== undefined && profile !== PREVIEW_MODE)
    throw new BuildRefusal("VITE_DEPLOYMENT_PROFILE must be client-preview (or omitted)");
  if ((values.VITE_AUTH_SOCIAL_PROVIDERS ?? "") !== "")
    throw new BuildRefusal("social sign-in must stay off in the client preview");
  const email = values.VITE_SUPPORT_EMAIL ?? "";
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email))
    throw new BuildRefusal("VITE_SUPPORT_EMAIL is not an e-mail address");

  let url;
  try {
    url = new URL(values.VITE_SUPABASE_URL ?? "");
  } catch {
    throw new BuildRefusal("VITE_SUPABASE_URL is missing or unreadable");
  }
  if (url.protocol !== "https:") throw new BuildRefusal("VITE_SUPABASE_URL must use https");
  if (
    url.username ||
    url.password ||
    url.port ||
    (url.pathname && url.pathname !== "/") ||
    url.search
  )
    throw new BuildRefusal("VITE_SUPABASE_URL must be the project origin only");
  const key = values.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (key.startsWith("sb_secret_"))
    throw new BuildRefusal("a secret key must never be built into the app");

  if (placeholder) {
    if (!url.hostname.endsWith(".invalid"))
      throw new BuildRefusal("--placeholder builds use a reserved .invalid host only");
    if (!key.includes("PLACEHOLDER"))
      throw new BuildRefusal("--placeholder builds use a placeholder key");
    return { url: url.origin, key, ref: null };
  }

  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (!m) throw new BuildRefusal("VITE_SUPABASE_URL must be https://<ref>.supabase.co");
  if (!expectRef || m[1] !== expectRef)
    throw new BuildRefusal("VITE_SUPABASE_URL is not the project named by --expect-ref");
  if (key.startsWith("sb_publishable_")) {
    if (key.length < 24) throw new BuildRefusal("malformed publishable key");
  } else {
    const payload = jwtPayload(key);
    if (!payload || payload.role !== "anon")
      throw new BuildRefusal("VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable (or anon) key");
    if (payload.ref !== expectRef)
      throw new BuildRefusal("the anon key belongs to another project");
  }
  return { url: url.origin, key, ref: m[1] };
}

/** Refuses a checkout or shell whose environment would leak into the build. */
export function assertCleanBuildContext(root, env) {
  for (const f of LOADED_ENV_FILES)
    if (fs.existsSync(path.join(root, f)))
      throw new BuildRefusal(
        `${f} exists in this checkout (Vite would load it into the build); build from a clean checkout`,
      );
  const leaked = Object.keys(env).filter((k) => SHELL_OVERRIDES.test(k));
  if (leaked.length)
    throw new BuildRefusal(
      `the shell exports ${leaked.join(", ")} (they would override ${PREVIEW_ENV_FILE})`,
    );
}

/** Post-build hardening of the output (static assets bypass the server headers). */
export function hardenOutput(outputDir) {
  const pub = path.join(outputDir, "public");
  fs.writeFileSync(path.join(pub, "robots.txt"), ROBOTS_TXT);
  const headersFile = path.join(pub, "_headers");
  const current = fs.existsSync(headersFile) ? fs.readFileSync(headersFile, "utf8") : "";
  fs.writeFileSync(headersFile, `${ASSET_HEADERS}\n${current}`.trimEnd() + "\n");
  const wranglerFile = path.join(outputDir, "server/wrangler.json");
  const wrangler = JSON.parse(fs.readFileSync(wranglerFile, "utf8"));
  wrangler.name = WORKER_NAME;
  fs.writeFileSync(wranglerFile, `${JSON.stringify(wrangler, null, 2)}\n`);
}

function args(argv) {
  const out = { placeholder: false, expectRef: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--placeholder") out.placeholder = true;
    else if (argv[i] === "--expect-ref") out.expectRef = argv[++i];
    else throw new BuildRefusal(`unknown argument ${argv[i]}`);
  }
  if (!out.placeholder && !out.expectRef)
    throw new BuildRefusal("pass --expect-ref <ref> (or --placeholder)");
  return out;
}

async function main(argv) {
  const opts = args(argv);
  assertCleanBuildContext(ROOT, process.env);
  const file = path.join(ROOT, PREVIEW_ENV_FILE);
  if (!fs.existsSync(file)) throw new BuildRefusal(`${PREVIEW_ENV_FILE} not found`);
  const values = validatePreviewBuildEnv(parseEnvFile(fs.readFileSync(file, "utf8")), opts);
  console.log(
    `client-preview build: backend ${opts.placeholder ? "placeholder (.invalid)" : `project ${values.ref}`}`,
  );

  for (const dir of [".output", ".wrangler"])
    fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
  const vite = path.join(ROOT, "node_modules/vite/bin/vite.js");
  const run = spawnSync(process.execPath, [vite, "build", "--mode", PREVIEW_MODE], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VITE_DEPLOYMENT_PROFILE: PREVIEW_MODE },
  });
  if (run.status !== 0) throw new BuildRefusal(`vite build failed (exit ${run.status})`);

  const output = path.join(ROOT, ".output");
  hardenOutput(output);
  const result = scanBundle(output, {
    expectedSupabaseUrl: values.url,
    expectedPublishableKey: values.key,
    deny: (process.env.PREVIEW_BUNDLE_DENY ?? "").split(","),
  });
  printReport(result);
  if (result.errors.length) process.exit(1);
  console.log("client-preview build ready in .output (not deployed)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2)).catch((e) => {
    if (e instanceof BuildRefusal) {
      console.error(e.message);
      process.exit(3);
    }
    throw e;
  });
