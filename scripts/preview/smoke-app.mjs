// End-to-end smoke test of a client-preview app (the built Worker), through the SAME server
// functions the browser calls, signed in with the demo accounts:
//   pages      /auth renders with the preview headers, /signup redirects, robots disallow all
//   reads      menu, stock/recipes/finance resources and orders for every store (owner)
//   POS        one sale at Downtown through submitOperationalSale (prices/tax/stock/COGS by the server)
//   KDS        the kitchen account moves it in_prep -> ready -> delivered (changeOperationalOrder)
//   stock      the sale consumed exactly the recipe (lemonade base in gal: 0.1)
//   finance    the sale's revenue = total - tax appears in the resources ledger
//   isolation  the Westside manager and the Downtown kitchen cannot read the other store; no token
//              is refused; no account is a platform admin
//
//   PREVIEW_APP_URL=http://127.0.0.1:8799 | https://<name>.workers.dev | https://preview.dinequora.com
//   PREVIEW_CREDS_FILE=<credentials written by the seed> PREVIEW_PUBLISHABLE_KEY=<publishable key>
//   [PREVIEW_BUILD_DIR=.output] node scripts/preview/smoke-app.mjs
// Writes only as the demo accounts, through the app (one sale per run, client id cp-smoke-<time>).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fromCrossJSON, toJSONAsync } from "seroval";
// The router plugins the browser uses (the app registers no extra serialization adapters).
import { createDefaultSerovalPlugins } from "@tanstack/router-core/ssr/client";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const APP = String(process.env.PREVIEW_APP_URL ?? "").replace(/\/+$/, "");
const ALLOWED_APP =
  /^(http:\/\/(127\.0\.0\.1|localhost):\d{2,5}|https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev|https:\/\/preview\.dinequora\.com)$/;
if (!ALLOWED_APP.test(APP)) {
  console.error(
    "refused: PREVIEW_APP_URL must be a local run, a workers.dev URL or https://preview.dinequora.com",
  );
  process.exit(3);
}
const creds = JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDS_FILE ?? "", "utf8"));
if (creds.kind !== "dinequora-client-preview") {
  console.error("refused: not a client-preview credentials file");
  process.exit(3);
}
const KEY = process.env.PREVIEW_PUBLISHABLE_KEY;

// Server function ids from the build being tested.
const serverDir = path.join(process.env.PREVIEW_BUILD_DIR ?? ".output", "server");
const resolver = fs
  .readdirSync(serverDir)
  .find((f) => f.startsWith("__23tanstack-start-server-fn-resolver"));
const ids = Object.fromEntries(
  [
    ...fs
      .readFileSync(path.join(serverDir, resolver), "utf8")
      .matchAll(/"([a-f0-9]{64})": \{\s*functionName: "(\w+)_createServerFn_handler"/g),
  ].map((m) => [m[2], m[1]]),
);
const plugins = createDefaultSerovalPlugins();

const timings = [];
async function call(fn, data, token) {
  const started = Date.now();
  const body = JSON.stringify(await toJSONAsync({ data }, { plugins }));
  const res = await fetch(`${APP}/_serverFn/${ids[fn]}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-tsr-serverFn": "true",
      origin: APP,
      "sec-fetch-site": "same-origin",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  const text = await res.text();
  // Wall time and payload size per call: on Workers Free the CPU limit is 10 ms per request, so the
  // largest payloads (parse + serialize) are the ones to watch on the deployed Worker.
  timings.push({ fn, ms: Date.now() - started, kib: Math.round(text.length / 1024) });
  let payload;
  try {
    // Responses use the cross-reference format, read like the browser client does.
    payload = fromCrossJSON(JSON.parse(text), { plugins, refs: new Map() });
  } catch {
    return { status: res.status, error: text.slice(0, 120) };
  }
  if (payload?.error)
    return { status: res.status, error: String(payload.error?.message ?? payload.error) };
  return { status: res.status, result: payload?.result };
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
async function session(key) {
  const c = createClient(creds.apiUrl, KEY, opts);
  const { data, error } = await c.auth.signInWithPassword({
    email: creds.accounts[key].email,
    password: creds.accounts[key].password,
  });
  if (error) throw new Error(`sign-in ${key}: ${error.message}`);
  return { client: c, token: data.session.access_token };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  [${detail}]` : ""}`);
};
const len = (x) => (Array.isArray(x) ? x.length : -1);

// ---- pages ------------------------------------------------------------------------------------
const auth = await fetch(`${APP}/auth`);
const html = await auth.text();
check(
  "/auth renders (SSR) with no sign-up link",
  auth.status === 200 && html.includes("Sign in") && !html.includes('href="/signup"'),
  auth.status,
);
check(
  "/auth carries X-Robots-Tag, X-Frame-Options and frame-ancestors",
  auth.headers.get("x-robots-tag")?.includes("noindex") &&
    auth.headers.get("x-frame-options") === "DENY" &&
    auth.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"),
);
const signup = await fetch(`${APP}/signup`, { redirect: "manual" });
check(
  "/signup redirects to /auth",
  [302, 307, 308].includes(signup.status) && signup.headers.get("location")?.endsWith("/auth"),
  signup.status,
);
check(
  "robots.txt disallows every crawler",
  /Disallow: \/\s*$/m.test(await (await fetch(`${APP}/robots.txt`)).text()),
);

// ---- reads (owner) ------------------------------------------------------------------------------
const owner = await session("owner");
const { data: locs } = await owner.client
  .from("locations")
  .select("id,slug,name")
  .eq("org_id", creds.org.id);
const slug = Object.fromEntries(locs.map((l) => [l.name.toLowerCase(), l.slug]));
const orgSlug = creds.org.slug;
const menu = await call("fetchOperationalMenu", { orgId: orgSlug }, owner.token);
const menuItems = menu.result?.items ?? menu.result?.products ?? menu.result?.menu ?? [];
check(
  "menu: 19 products for the owner",
  len(menuItems) === 19,
  menu.error ?? `${len(menuItems)} (${Object.keys(menu.result ?? {}).join(",")})`,
);
for (const store of ["downtown", "westside", "airport"]) {
  const r = await call(
    "fetchOperationalResources",
    { orgId: orgSlug, locationId: slug[store] },
    owner.token,
  );
  const inv = r.result?.inventory ?? [];
  const store_ = inv.filter(
    (i) => !i.location_id || i.location_id === locs.find((l) => l.slug === slug[store])?.id,
  );
  check(
    `resources ${store}: stock, recipes and finance ledger`,
    len(inv) > 0 && len(r.result?.recipes) > 0 && len(r.result?.finance) > 0,
    r.error ??
      `stock ${len(store_)} recipes ${len(r.result?.recipes)} ledger ${len(r.result?.finance)} expenses ${len(r.result?.expenses)}`,
  );
  const o = await call(
    "fetchOperationalOrders",
    {
      orgId: orgSlug,
      locationId: slug[store],
      statuses: ["new", "confirmed", "in_prep", "ready"],
      limit: 50,
    },
    owner.token,
  );
  const list = o.result?.orders ?? o.result ?? [];
  check(`kitchen board ${store}: open tickets`, len(list) >= 5, o.error ?? len(list));
}

// ---- POS sale through the app, then KDS, stock and finance --------------------------------------
const downtownId = locs.find((l) => l.slug === slug.downtown).id;
const lemonadeBefore = (
  await owner.client
    .from("inventory_items")
    .select("id,quantity")
    .eq("location_id", downtownId)
    .eq("sku", "LEMONADE")
    .single()
).data;
const clientOrderId = `cp-smoke-${Date.now()}`;
const sale = await call(
  "submitOperationalSale",
  {
    orgId: orgSlug,
    locationId: slug.downtown,
    clientOrderId,
    orderType: "takeout",
    customerName: "Smoke Test (demo)",
    discountCents: 0,
    taxRatePpm: 70000,
    paymentMethod: "card",
    isSimulation: false,
    items: [
      { productId: "prod-classic-burger", quantity: 1, modifiers: [] },
      { productId: "prod-fries", quantity: 1, modifiers: [] },
      { productId: "prod-lemonade", quantity: 1, modifiers: [] },
    ],
  },
  owner.token,
);
const expectedSubtotal = 1350 + 450 + 395;
const expectedTax = Math.round((expectedSubtotal * 70000) / 1_000_000);
check(
  "POS: sale recorded through submitOperationalSale with server prices and store tax",
  sale.result?.totalCents === expectedSubtotal + expectedTax,
  sale.error ?? JSON.stringify(sale.result),
);
const { data: order } = await owner.client
  .from("orders")
  .select("id,status,total_cents,tax_cents")
  .eq("client_order_id", clientOrderId)
  .single();
const kitchen = await session("kitchen");
const steps = [];
for (const status of ["in_prep", "ready", "delivered"])
  steps.push(
    (await call("changeOperationalOrder", { id: order.id, status }, kitchen.token)).error ?? "ok",
  );
const { data: after } = await owner.client
  .from("orders")
  .select("status")
  .eq("id", order.id)
  .single();
check(
  "KDS: the kitchen account moved the ticket in_prep -> ready -> delivered",
  after.status === "delivered" && steps.every((s) => s === "ok"),
  steps.join(","),
);
const lemonadeAfter = (
  await owner.client.from("inventory_items").select("quantity").eq("id", lemonadeBefore.id).single()
).data;
check(
  "stock: the sale consumed 0.1 gal of lemonade base (recipe in gal)",
  Math.abs(Number(lemonadeBefore.quantity) - Number(lemonadeAfter.quantity) - 0.1) < 1e-9,
  `${lemonadeBefore.quantity} -> ${lemonadeAfter.quantity}`,
);
const res2 = await call(
  "fetchOperationalResources",
  { orgId: orgSlug, locationId: slug.downtown },
  owner.token,
);
const rev = (res2.result?.finance ?? []).find(
  (e) => e.order_id === order.id && e.kind === "revenue",
);
check(
  "finance: the sale's revenue (total - tax) is in the ledger the screens read",
  rev?.amount_cents === order.total_cents - order.tax_cents,
  rev?.amount_cents,
);

const allRes = await call("fetchOperationalResources", { orgId: orgSlug }, owner.token);
const { count: ledgerRows } = await owner.client
  .from("finance_entries")
  .select("id", { count: "exact", head: true });
check(
  "Finance/Reports: the app reads the complete ledger",
  len(allRes.result?.finance) === ledgerRows,
  `${len(allRes.result?.finance)} read / ${ledgerRows} in the database`,
);

// ---- isolation ----------------------------------------------------------------------------------
const manager = await session("manager");
const mDown = await call(
  "fetchOperationalOrders",
  { orgId: orgSlug, locationId: slug.downtown, limit: 5 },
  manager.token,
);
const mList = mDown.result?.orders ?? mDown.result ?? [];
check(
  "Westside manager cannot read Downtown orders",
  Boolean(mDown.error) || len(mList) === 0,
  mDown.error ?? len(mList),
);
const kWest = await call(
  "fetchOperationalOrders",
  { orgId: orgSlug, locationId: slug.westside, limit: 5 },
  kitchen.token,
);
const kList = kWest.result?.orders ?? kWest.result ?? [];
check(
  "Downtown kitchen cannot read Westside orders",
  Boolean(kWest.error) || len(kList) === 0,
  kWest.error ?? len(kList),
);
const noToken = await call("fetchOperationalOrders", { orgId: orgSlug, limit: 5 });
check(
  "no session: server functions refuse",
  /Unauthorized/.test(noToken.error ?? ""),
  noToken.error,
);
const admin = await owner.client.rpc("is_platform_admin");
check(
  "owner is not a platform admin (Control Center closed)",
  admin.data === false,
  JSON.stringify(admin.data),
);

const byFn = {};
for (const t of timings) (byFn[t.fn] ??= []).push(t);
for (const [fn, ts] of Object.entries(byFn))
  console.log(
    `timing ${fn}: ${ts.length} calls, max ${Math.max(...ts.map((t) => t.ms))} ms, max ${Math.max(...ts.map((t) => t.kib))} KiB`,
  );
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} app checks passed against ${APP}`);
if (process.env.PREVIEW_REPORT_FILE)
  fs.writeFileSync(
    process.env.PREVIEW_REPORT_FILE,
    JSON.stringify({ app: APP, at: new Date().toISOString(), results, timings }, null, 2),
  );
process.exit(failed ? 1 : 0);
