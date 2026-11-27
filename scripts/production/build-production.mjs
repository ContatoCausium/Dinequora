// Builds the PRODUCTION app (Cloudflare Workers, preset cloudflare-module) from this checkout.
//
//   node scripts/production/build-production.mjs --expect-ref <20-character project ref>
//
// Values come ONLY from .env.production.local (git-ignored; public values only):
//   VITE_SUPABASE_URL=https://<ref>.supabase.co
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…          (never a secret/service-role key)
//   VITE_AUTH_SOCIAL_PROVIDERS=                             (empty: e-mail and password only)
//   VITE_SUPPORT_EMAIL=                                     (optional)
// The profile VITE_DEPLOYMENT_PROFILE=production is forced by this script: the normal product (public
// sign-up, plans on the billing screen) with the security and no-index headers on.
//
// Refuses before building when: .env, .env.local or .env.production exist (Vite would load them in
// production mode, e.g. the QA URL of a local checkout), the shell exports VITE_*/SUPABASE_*/NITRO_*/
// LOVABLE_* variables, the file has other keys, the URL is not the expected hosted project, or the
// key is not a publishable key of that project. After the build it writes the no-index robots.txt
// and static-asset headers, names the Worker dinequora-app, serves it only on its custom domain
// (app.dinequora.com; workers.dev and version preview URLs off) and runs the bundle verifier with the
// production target. Nothing is deployed.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ASSET_HEADERS, parseEnvFile, ROBOTS_TXT } from "../preview/build-client-preview.mjs";
import { printReport, scanBundle, TARGETS } from "../preview/verify-bundle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PRODUCTION_MODE = "production";
export const PRODUCTION_ENV_FILE = ".env.production.local";
/** Loaded by Vite in production mode besides PRODUCTION_ENV_FILE; they must not exist. */
export const PRODUCTION_LOADED_ENV_FILES = [".env", ".env.local", ".env.production"];
const ALLOWED_KEYS = new Set([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_AUTH_SOCIAL_PROVIDERS",
  "VITE_SUPPORT_EMAIL",
  "VITE_DEPLOYMENT_PROFILE",
]);
const SHELL_OVERRIDES = /^(VITE_|SUPABASE_|NITRO_|SERVER_PRESET$|LOVABLE_)/;

export class ProductionBuildRefusal extends Error {
  constructor(message) {
    super(`production build refused: ${message}`);
    this.name = "ProductionBuildRefusal";
  }
}

/** Pure validation of the production build values. Returns { url, key, ref }. */
export function validateProductionBuildEnv(values, { expectRef } = {}) {
  for (const key of Object.keys(values))
    if (!ALLOWED_KEYS.has(key))
      throw new ProductionBuildRefusal(
        `${PRODUCTION_ENV_FILE} may only hold public build values (unexpected ${key})`,
      );
  const profile = values.VITE_DEPLOYMENT_PROFILE;
  if (profile !== undefined && profile !== PRODUCTION_MODE)
    throw new ProductionBuildRefusal("VITE_DEPLOYMENT_PROFILE must be production (or omitted)");
  // Google sign-in goes through the Lovable broker today and would fail on the production project
  // (docs/operations/production-environment.md §6): e-mail and password only until it is replaced.
  if ((values.VITE_AUTH_SOCIAL_PROVIDERS ?? "") !== "")
    throw new ProductionBuildRefusal("social sign-in stays off until it works on the own project");
  const email = values.VITE_SUPPORT_EMAIL ?? "";
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email))
    throw new ProductionBuildRefusal("VITE_SUPPORT_EMAIL is not an e-mail address");

  let url;
  try {
    url = new URL(values.VITE_SUPABASE_URL ?? "");
  } catch {
    throw new ProductionBuildRefusal("VITE_SUPABASE_URL is missing or unreadable");
  }
  if (url.protocol !== "https:")
    throw new ProductionBuildRefusal("VITE_SUPABASE_URL must use https");
  if (
    url.username ||
    url.password ||
    url.port ||
    (url.pathname && url.pathname !== "/") ||
    url.search
  )
    throw new ProductionBuildRefusal("VITE_SUPABASE_URL must be the project origin only");
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (!m) throw new ProductionBuildRefusal("VITE_SUPABASE_URL must be https://<ref>.supabase.co");
  if (!expectRef || m[1] !== expectRef)
    throw new ProductionBuildRefusal("VITE_SUPABASE_URL is not the project named by --expect-ref");
  const key = values.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (key.startsWith("sb_secret_"))
    throw new ProductionBuildRefusal("a secret key must never be built into the app");
  if (!key.startsWith("sb_publishable_") || key.length < 24)
    throw new ProductionBuildRefusal("VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key");
  return { url: url.origin, key, ref: m[1] };
}

/** Refuses a checkout or shell whose environment would leak into the build. */
export function assertCleanProductionContext(root, env) {
  for (const f of PRODUCTION_LOADED_ENV_FILES)
    if (fs.existsSync(path.join(root, f)))
      throw new ProductionBuildRefusal(
        `${f} exists in this checkout (Vite would load it into the build); build from a clean checkout`,
      );
  const leaked = Object.keys(env).filter((k) => SHELL_OVERRIDES.test(k));
  if (leaked.length)
    throw new ProductionBuildRefusal(
      `the shell exports ${leaked.join(", ")} (they would override ${PRODUCTION_ENV_FILE})`,
    );
}

/** Post-build hardening of the output: no-index assets and the production Worker settings. */
export function hardenProductionOutput(outputDir) {
  const T = TARGETS.production;
  const pub = path.join(outputDir, "public");
  fs.writeFileSync(path.join(pub, "robots.txt"), ROBOTS_TXT);
  const headersFile = path.join(pub, "_headers");
  const current = fs.existsSync(headersFile) ? fs.readFileSync(headersFile, "utf8") : "";
  fs.writeFileSync(headersFile, `${ASSET_HEADERS}\n${current}`.trimEnd() + "\n");
  const wranglerFile = path.join(outputDir, "server/wrangler.json");
  const wrangler = JSON.parse(fs.readFileSync(wranglerFile, "utf8"));
  wrangler.name = T.workerName;
  // Served on the custom domain only. preview_urls stated explicitly: without it wrangler turns the
  // version preview URLs on at every deploy.
  wrangler.workers_dev = T.workersDev;
  wrangler.preview_urls = false;
  wrangler.routes = T.routes.map((r) => ({ ...r }));
  fs.writeFileSync(wranglerFile, `${JSON.stringify(wrangler, null, 2)}\n`);
}

function args(argv) {
  const out = { expectRef: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--expect-ref") out.expectRef = argv[++i];
    else throw new ProductionBuildRefusal(`unknown argument ${argv[i]}`);
  }
  if (!out.expectRef) throw new ProductionBuildRefusal("pass --expect-ref <ref>");
  return out;
}

async function main(argv) {
  const opts = args(argv);
  assertCleanProductionContext(ROOT, process.env);
  const file = path.join(ROOT, PRODUCTION_ENV_FILE);
  if (!fs.existsSync(file)) throw new ProductionBuildRefusal(`${PRODUCTION_ENV_FILE} not found`);
  const values = validateProductionBuildEnv(parseEnvFile(fs.readFileSync(file, "utf8")), opts);
  console.log(`production build: backend project ${values.ref}`);

  for (const dir of [".output", ".wrangler"])
    fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
  const vite = path.join(ROOT, "node_modules/vite/bin/vite.js");
  const run = spawnSync(process.execPath, [vite, "build", "--mode", PRODUCTION_MODE], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VITE_DEPLOYMENT_PROFILE: PRODUCTION_MODE },
  });
  if (run.status !== 0) throw new ProductionBuildRefusal(`vite build failed (exit ${run.status})`);

  const output = path.join(ROOT, ".output");
  hardenProductionOutput(output);
  const result = scanBundle(output, {
    expectedSupabaseUrl: values.url,
    expectedPublishableKey: values.key,
    deny: (process.env.PRODUCTION_BUNDLE_DENY ?? "").split(","),
    target: "production",
  });
  printReport(result, console.log, "production");
  if (result.errors.length) process.exit(1);
  console.log("production build ready in .output (not deployed)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2)).catch((e) => {
    if (e instanceof ProductionBuildRefusal) {
      console.error(e.message);
      process.exit(3);
    }
    throw e;
  });
