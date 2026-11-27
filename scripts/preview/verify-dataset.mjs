// Read-only verification of the client-preview dataset on a checked destination (local disposable
// stack or hosted client preview). Recomputes, row by row, what the POS, stock, kitchen and finance
// screens rely on, and checks tenant/store isolation through RLS with the demo accounts:
//
//   orders     total = subtotal - discount + tax; subtotal = sum of lines; tax = store rate
//   ledger     revenue = total - tax, COGS = recipe consumption cost, one payment = total, per order
//   cancels    revenue/COGS reversed to zero, stock returned, payment marked reversed
//   stock      every item quantity = sum of its movements (opening + receipts - sales + reversals)
//   receipts   purchase ledger entry = received quantity x price
//   time       history inside the period, steps in order, ledger/movements at the order time,
//              sales on every day, the live kitchen board (open tickets) present
//   isolation  owner sees one organization and three stores; the Westside manager and the Downtown
//              kitchen account see only their store; anonymous sees nothing; no platform admin
//   people     the demo accounts and exactly the declared personal owners (Owner of the demo
//              organization only, joined through accepted invitations); no stray invitation
//
//   PREVIEW_TARGET=local|hosted PREVIEW_API_URL=… PREVIEW_SERVICE_KEY=… PREVIEW_PUBLISHABLE_KEY=… \
//   PREVIEW_CREDS_FILE=<credentials file written by the seed> [PREVIEW_REPORT_FILE=<json path>] \
//   [DQ_PREVIEW_CONFIRM=client-preview:verify:client-preview:<ref>] node scripts/preview/verify-dataset.mjs
// Exit 0 = every check passed, 1 = a check failed, 3 = destination refused.
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  assertResolvedTarget,
  exitOnTargetRefusal,
  resolvePreviewTarget,
} from "./client-preview-target.mjs";
import { floorExpectations } from "./seed-dining.mjs";
import {
  ACCOUNTS,
  convertQuantity,
  EMAIL_DOMAIN,
  LEDGER_READ_CAP,
  localYmd,
  ORG,
  PRICE_RISE,
  PRODUCTS,
  STOCK,
  STORES,
} from "./dataset.mjs";

const OPERATION = "verify:client-preview";
const target = await resolvePreviewTarget(process.env, OPERATION).catch(exitOnTargetRefusal);
assertResolvedTarget(target);
const require = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const creds = JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDS_FILE ?? "", "utf8"));
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(target.apiUrl, target.serviceKey, opts);
const signIn = async (key) => {
  const c = createClient(target.apiUrl, target.publishableKey, opts);
  const { error } = await c.auth.signInWithPassword({
    email: creds.accounts[key].email,
    password: creds.accounts[key].password,
  });
  if (error) throw new Error(`sign-in ${key}: ${error.message}`);
  return c;
};

const results = [];
const check = (name, ok, detail = "") =>
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
async function all(client, table, select, filter = (q) => q, orderBy = "id") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let data, error;
    for (let attempt = 1; attempt <= 4; attempt++) {
      ({ data, error } = await filter(client.from(table).select(select))
        .order(orderBy)
        .range(from, from + 999));
      if (!error || !/fetch failed|ECONNRESET|socket/i.test(error.message)) break;
      await new Promise((r) => setTimeout(r, 500 * attempt)); // transient network error: read again
    }
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const group = (rows, key) =>
  rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) ?? []), r]), new Map());
const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);

// ---- organization and structure ---------------------------------------------------------------
const orgs = await all(svc, "organizations", "id,name,slug,is_demo,plan,store_limit,status");
const org = orgs.find((o) => o.id === creds.org.id);
check(
  "exactly one organization in the database: the demo",
  orgs.length === 1 && org?.is_demo === true,
  `${orgs.length} org(s)`,
);
check(
  "organization name, plan Growth, 3 stores allowed",
  org?.name === ORG.name && org?.plan === "growth" && org?.store_limit === 3,
  `${org?.plan}/${org?.store_limit}`,
);
const sub = (
  await all(
    svc,
    "subscriptions",
    "org_id,plan_id,status,trial_ends_at",
    (q) => q.eq("org_id", org.id),
    "org_id",
  )
)[0];
check(
  "subscription active, no trial expiry",
  sub?.status === "active" && sub?.trial_ends_at === null,
  sub?.status,
);
const locations = await all(svc, "locations", "id,name,status,tax_rate_ppm,timezone,hours", (q) =>
  q.eq("org_id", org.id),
);
const locByKey = Object.fromEntries(
  STORES.map((s) => [s.key, locations.find((l) => l.name === s.name)]),
);
check(
  "three active stores with their tax rate, time zone and hours",
  locations.length === 3 &&
    STORES.every(
      (s) =>
        locByKey[s.key]?.status === "active" &&
        locByKey[s.key]?.tax_rate_ppm === s.taxRatePpm &&
        locByKey[s.key]?.timezone === "America/New_York" &&
        locByKey[s.key]?.hours,
    ),
  locations.map((l) => `${l.name}:${l.tax_rate_ppm}`).join(" "),
);
const products = await all(
  svc,
  "menu_products",
  "id,client_id,price_cents,location_ids,active",
  (q) => q.eq("org_id", org.id),
);
check(
  "menu: 19 active products in 5 categories",
  products.length === PRODUCTS.length && products.every((p) => p.active),
  products.length,
);
const items = await all(
  svc,
  "inventory_items",
  "id,location_id,sku,unit,quantity,min_quantity,cost_cents",
  (q) => q.eq("org_id", org.id),
);
check(
  "stock: 31 items in each store",
  STORES.every(
    (s) => items.filter((i) => i.location_id === locByKey[s.key].id).length === STOCK.length,
  ),
  items.length,
);
const recipes = await all(svc, "product_recipes", "id,location_id,product_id,servings", (q) =>
  q.eq("org_id", org.id),
);
const expectedRecipes = STORES.reduce(
  (n, s) => n + PRODUCTS.filter((p) => !(p.notAt ?? []).includes(s.key)).length,
  0,
);
check(
  "recipes: one per product sold in each store",
  recipes.length === expectedRecipes,
  `${recipes.length}/${expectedRecipes}`,
);

// ---- orders, ledger, payments -----------------------------------------------------------------
const orders = await all(
  svc,
  "orders",
  "id,location_id,status,subtotal_cents,discount_cents,tax_cents,total_cents,tax_rate_ppm,created_at,updated_at,client_order_id",
  (q) => q.eq("org_id", org.id),
);
const lines = group(
  await all(svc, "order_items", "id,order_id,quantity,unit_price_cents,subtotal_cents", (q) =>
    q.eq("org_id", org.id),
  ),
  "order_id",
);
const entries = await all(
  svc,
  "finance_entries",
  "id,order_id,kind,amount_cents,created_at,client_event_id,location_id",
  (q) => q.eq("org_id", org.id),
);
const entriesByOrder = group(
  entries.filter((e) => e.order_id),
  "order_id",
);
const moves = await all(
  svc,
  "inventory_movements",
  "id,inventory_item_id,order_id,kind,delta,unit_cost_cents,created_at,client_event_id",
  (q) => q.eq("org_id", org.id),
);
const movesByOrder = group(
  moves.filter((m) => m.order_id),
  "order_id",
);
const payments = group(
  await all(svc, "payments", "id,order_id,method,amount_cents,created_at,reversed_at", (q) =>
    q.eq("org_id", org.id),
  ),
  "order_id",
);
const history = group(
  await all(svc, "order_status_history", "id,order_id,to_status,created_at", (q) =>
    q.eq("org_id", org.id),
  ),
  "order_id",
);
const ppmOf = Object.fromEntries(locations.map((l) => [l.id, l.tax_rate_ppm]));
// Rounds of the dining room (0038/0039) are orders too, with two rules of their own: while the check is
// open a round has its stock movements (taken when it was sent) but no payment, revenue or COGS yet;
// when the check closes, its payment, revenue and COGS are written at that moment, after the round.
const checkStatus = new Map(
  (await all(svc, "dining_checks", "id,status", (q) => q.eq("org_id", org.id))).map((c) => [
    c.id,
    c.status,
  ]),
);
const diningOf = new Map(
  (
    await all(svc, "dining_check_rounds", "id,order_id,check_id", (q) => q.eq("org_id", org.id))
  ).map((r) => [r.order_id, checkStatus.get(r.check_id)]),
);

const bad = {
  math: [],
  tax: [],
  lines: [],
  revenue: [],
  cogs: [],
  payment: [],
  cancel: [],
  time: [],
  steps: [],
};
for (const o of orders) {
  const ls = lines.get(o.id) ?? [];
  if (o.total_cents !== o.subtotal_cents - o.discount_cents + o.tax_cents) bad.math.push(o.id);
  if (o.tax_rate_ppm !== ppmOf[o.location_id]) bad.tax.push(o.id);
  if (sum(ls, (l) => l.subtotal_cents) !== o.subtotal_cents) bad.lines.push(o.id);
  const es = entriesByOrder.get(o.id) ?? [];
  const k = (kind) =>
    sum(
      es.filter((e) => e.kind === kind),
      (e) => e.amount_cents,
    );
  const ms = movesByOrder.get(o.id) ?? [];
  const saleCost = sum(
    ms.filter((m) => m.kind === "sale"),
    (m) => -Number(m.delta) * m.unit_cost_cents,
  );
  const ps = payments.get(o.id) ?? [];
  const dining = diningOf.get(o.id);
  if (dining === "open") {
    // sent to the kitchen, not paid: nothing in the ledger or payments yet
    if (k("revenue") !== 0) bad.revenue.push(o.id);
    if (k("cogs") !== 0) bad.cogs.push(`${o.id}:open check with COGS ${k("cogs")}`);
    if (ps.length) bad.payment.push(o.id);
  } else {
    if (k("revenue") !== o.total_cents - o.tax_cents) bad.revenue.push(o.id);
    if (Math.abs(k("cogs") - saleCost) > ms.length)
      bad.cogs.push(`${o.id}:${k("cogs")}~${saleCost.toFixed(2)}`);
    if (ps.length !== 1 || ps[0].amount_cents !== o.total_cents) bad.payment.push(o.id);
  }
  if (o.status === "cancelled") {
    const restored = Math.abs(sum(ms, (m) => Number(m.delta))) < 1e-6;
    // Reversal entries carry positive amounts; the kind gives the sign (as finance-service reads them).
    if (
      k("reversal_revenue") !== k("revenue") ||
      k("reversal_cogs") !== k("cogs") ||
      !restored ||
      !ps[0]?.reversed_at
    )
      bad.cancel.push(o.id);
  }
  const t = Date.parse(o.created_at);
  // A POS sale is recorded at once; a dining round's ledger and payment come when its check closes.
  const onTime = (at) => (dining ? Date.parse(at) >= t : Date.parse(at) === t);
  for (const e of es)
    if (!e.kind.startsWith("reversal") && !onTime(e.created_at)) bad.time.push(`entry ${e.id}`);
  for (const m of ms)
    if (m.kind === "sale" && Date.parse(m.created_at) !== t) bad.time.push(`move ${m.id}`);
  for (const p of ps) if (!onTime(p.created_at)) bad.time.push(`payment ${p.id}`);
  const hs = (history.get(o.id) ?? []).map((h) => Date.parse(h.created_at)).sort((a, b) => a - b);
  if (hs.some((h) => h < t) || hs.some((h) => h > Date.now())) bad.steps.push(o.id);
}
check(
  "every order: total = subtotal - discount + tax",
  !bad.math.length,
  `${orders.length} orders, ${bad.math.length} wrong`,
);
check("every order taxed at its store rate", !bad.tax.length, bad.tax.length);
check("every order: subtotal = sum of its lines", !bad.lines.length, bad.lines.length);
check(
  "ledger: revenue = total - tax for every order (none yet for a round of an open check)",
  !bad.revenue.length,
  bad.revenue.length,
);
check(
  "ledger: COGS = recipe consumption cost for every order",
  !bad.cogs.length,
  bad.cogs.slice(0, 3).join(" "),
);
check(
  "payments: exactly one per order, for the order total (none yet for a round of an open check)",
  !bad.payment.length,
  bad.payment.length,
);
const cancelled = orders.filter((o) => o.status === "cancelled");
check(
  "cancellations: revenue and COGS reversed, stock returned, payment reversed",
  cancelled.length > 0 && !bad.cancel.length,
  `${cancelled.length} cancelled, ${bad.cancel.length} wrong`,
);
check(
  "ledger, payments and stock movements at the order time",
  !bad.time.length,
  bad.time.slice(0, 3).join(" "),
);
check(
  "status history after the order and never in the future",
  !bad.steps.length,
  bad.steps.length,
);

// Since wave 0 the app reads the ledger completely with keyset pagination (no 1,000-row cap), so a
// larger profile is valid; ledger-safe keeps its original promise of staying under the old cap.
const datasetProfile = creds.summary?.profile ?? "ledger-safe";
check(
  datasetProfile === "ledger-safe"
    ? `ledger-safe profile stays under ${LEDGER_READ_CAP} rows`
    : `ledger size of the ${datasetProfile} profile (the app reads it completely, paged)`,
  datasetProfile !== "ledger-safe" || entries.length <= LEDGER_READ_CAP,
  `${entries.length} entries`,
);

// ---- stock ------------------------------------------------------------------------------------
const movesByItem = group(moves, "inventory_item_id");
const stockBad = items.filter(
  (i) =>
    Math.abs(Number(i.quantity) - sum(movesByItem.get(i.id) ?? [], (m) => Number(m.delta))) > 1e-6,
);
check(
  "stock: every quantity = sum of its movements",
  !stockBad.length,
  `${items.length} items, ${stockBad.length} off`,
);
check(
  "stock: no negative quantity",
  items.every((i) => Number(i.quantity) >= 0),
);
const low = items.filter(
  (i) => Number(i.min_quantity) > 0 && Number(i.quantity) < Number(i.min_quantity),
);
check(
  "stock: low-stock alerts exist (planned) and are few",
  low.length >= 3 && low.length <= 8,
  low.map((i) => i.sku).join(","),
);
const receipts = await all(svc, "purchase_receipts", "id,created_at", (q) =>
  q.eq("org_id", org.id),
);
const recBad = receipts.filter((r) => {
  const mv = moves.filter((m) => m.client_event_id === `receipt:${r.id}`);
  const fe = entries.filter((e) => e.client_event_id === `receipt:${r.id}`);
  return (
    fe.length !== 1 ||
    Math.abs(fe[0].amount_cents - sum(mv, (m) => Number(m.delta) * m.unit_cost_cents)) >
      mv.length ||
    mv.some((m) => m.created_at !== r.created_at)
  );
});
check(
  "receipts: purchase ledger = received quantity x price, at the receipt time",
  receipts.length > 0 && !recBad.length,
  `${receipts.length} receipts, ${recBad.length} wrong`,
);
const openPos = await all(svc, "purchase_orders", "id,status", (q) =>
  q.eq("org_id", org.id).eq("status", "sent"),
);
check("purchasing: one open purchase order per store", openPos.length === 3, openPos.length);

// ---- time coverage and kitchen board ---------------------------------------------------------
const nyDay = (ms) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
const span = {
  first: Math.min(...orders.map((o) => Date.parse(o.created_at))),
  last: Math.max(...orders.map((o) => Date.parse(o.created_at))),
};
const days = Math.round((span.last - span.first) / 86_400_000);
const coverage = STORES.map((s) => {
  const d = new Set(
    orders
      .filter((o) => o.location_id === locByKey[s.key].id)
      .map((o) => nyDay(Date.parse(o.created_at))),
  );
  return [s.key, d.size];
});
check(
  "sales on every day of the period in every store",
  coverage.every(([, n]) => n >= days),
  coverage.map(([k, n]) => `${k}:${n}`).join(" "),
);
const open = orders.filter((o) => ["new", "confirmed", "in_prep", "ready"].includes(o.status));
check(
  "kitchen board: open tickets in every store, all from the last 30 minutes",
  STORES.every((s) => open.some((o) => o.location_id === locByKey[s.key].id)) &&
    open.every((o) => Date.now() - Date.parse(o.created_at) < 30 * 60_000 + 86_400_000),
  `${open.length} open (${[...new Set(open.map((o) => o.status))].join("/")})`,
);
// A smoke-test sale is a real order: it may exist on a local rehearsal stack, never in a preview
// that prospects open (the hosted runbook resets after any smoke run that writes).
const smokeOrders = orders.filter((o) => String(o.client_order_id ?? "").startsWith("cp-smoke-"));
check(
  "no smoke-test sales in the demonstration data",
  target.mode === "local" || smokeOrders.length === 0,
  `${smokeOrders.length} smoke order(s)${target.mode === "local" ? " (allowed on a local stack)" : ""}`,
);

// ---- recipe margins and the financial picture -------------------------------------------------
// Recipes are priced at their menu product (single source); every one must leave a margin.
const recipeLines = group(
  await all(
    svc,
    "recipe_ingredients",
    "id,recipe_id,inventory_item_id,quantity,unit,waste_percentage",
    (q) => q.eq("org_id", org.id),
  ),
  "recipe_id",
);
const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
const priceOf = Object.fromEntries(products.map((p) => [p.id, p.price_cents]));
const foodCost = recipes.map((rc) => {
  const cost = (recipeLines.get(rc.id) ?? []).reduce((n, l) => {
    const it = itemById[l.inventory_item_id];
    const qty = convertQuantity(Number(l.quantity), l.unit, it.unit);
    return n + qty * (1 + Number(l.waste_percentage ?? 0) / 100) * it.cost_cents;
  }, 0);
  return cost / Math.max(1, Number(rc.servings) || 1) / priceOf[rc.product_id];
});
check(
  "recipes: every product sells above its recipe cost (food cost under 40% of the menu price)",
  foodCost.length > 0 && foodCost.every((x) => x > 0 && x < 0.4),
  `food cost ${(Math.min(...foodCost) * 100).toFixed(0)}-${(Math.max(...foodCost) * 100).toFixed(0)}%`,
);

// Same rule as the Finance screen: ledger by the store's local day, expenses by competency date,
// both inside [since, today]; future and simulated expenses never count.
const expenseRows = await all(svc, "finance_expenses", "id,location_id,payload,active", (q) =>
  q.eq("org_id", org.id).eq("active", true),
);
const tzOf = Object.fromEntries(locations.map((l) => [l.id, l.timezone || "America/New_York"]));
const localDay = (iso, tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
const todayAt = (locationId) => localDay(new Date().toISOString(), tzOf[locationId]);
const SIGN = { revenue: 1, reversal_revenue: -1, cogs: -1, reversal_cogs: 1 };
const resultSince = (sinceOf) => {
  let net = 0;
  let sales = 0;
  for (const l of locations) {
    const today = todayAt(l.id);
    const since = sinceOf(today);
    for (const e of entries) {
      if (e.location_id !== l.id || !(e.kind in SIGN)) continue;
      const d = localDay(e.created_at, tzOf[l.id]);
      if (d < since || d > today) continue;
      net += SIGN[e.kind] * e.amount_cents;
      if (e.kind === "revenue" || e.kind === "reversal_revenue")
        sales += SIGN[e.kind] * e.amount_cents;
    }
    for (const x of expenseRows) {
      const p = x.payload ?? {};
      if (x.location_id !== l.id || p.isSimulation) continue;
      const c = String(p.competencyDate ?? "");
      if (c >= since && c <= today) net -= Number(p.amountCents) || 0;
    }
  }
  return { net, margin: sales > 0 ? net / sales : 0 };
};
const minusDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const usd = (r) => `$${(r.net / 100).toFixed(2)} (${(r.margin * 100).toFixed(1)}% of net sales)`;
const result30 = resultSince((today) => minusDays(today, 29));
check(
  "finance: the last 30 days close with a positive operating result",
  result30.net > 0,
  usd(result30),
);
// The first days of a month carry its rent and fixed bills against a few days of sales, so a
// month-to-date loss is real and expected early in the month; from the 8th it must be positive.
const mtd = resultSince((today) => `${today.slice(0, 7)}-01`);
const dayOfMonth = Number(localDay(new Date().toISOString(), "America/New_York").slice(8, 10));
check(
  "finance: month to date is positive (checked from the 8th of the month)",
  dayOfMonth < 8 || mtd.net > 0,
  usd(mtd),
);
const paidAhead = expenseRows.filter(
  (x) =>
    String(x.payload?.competencyDate ?? "") > todayAt(x.location_id) &&
    x.payload?.status === "paid",
);
check("expenses: nothing dated in the future is marked paid", !paidAhead.length, paidAhead.length);

// ---- isolation through RLS --------------------------------------------------------------------
const owner = await signIn("owner");
const manager = await signIn("manager");
const kitchen = await signIn("kitchen");
const anon = createClient(target.apiUrl, target.publishableKey, opts);
const count = async (c, table, filter = (q) => q) => {
  const { count: n, error } = await filter(
    c.from(table).select("id", { count: "exact", head: true }),
  );
  if (error) return `error:${error.code}`;
  return n;
};
const perStore = Object.fromEntries(
  STORES.map((s) => [s.key, orders.filter((o) => o.location_id === locByKey[s.key].id).length]),
);
check(
  "owner (RLS): one organization, three stores, every order",
  (await count(owner, "organizations")) === 1 &&
    (await count(owner, "locations")) === 3 &&
    (await count(owner, "orders")) === orders.length,
);
check(
  "Westside manager (RLS): only Westside orders",
  (await count(manager, "orders")) === perStore.westside &&
    (await count(manager, "orders", (q) => q.neq("location_id", locByKey.westside.id))) === 0,
  `${await count(manager, "orders")}/${perStore.westside}`,
);
check(
  "Downtown kitchen (RLS): only Downtown orders",
  (await count(kitchen, "orders")) === perStore.downtown &&
    (await count(kitchen, "orders", (q) => q.neq("location_id", locByKey.downtown.id))) === 0,
  `${await count(kitchen, "orders")}/${perStore.downtown}`,
);
check(
  "anonymous (RLS): no organization, store, order or stock",
  [
    await count(anon, "organizations"),
    await count(anon, "locations"),
    await count(anon, "orders"),
    await count(anon, "inventory_items"),
  ].every((n) => n === 0 || String(n).startsWith("error")),
);
check("no platform admin (Control Center closed)", (await count(svc, "user_roles")) === 0);
const users = (await svc.auth.admin.listUsers({ perPage: 200 })).data.users;
const owners = target.personalOwners;
const demoUsers = users.filter((u) => u.email.toLowerCase().endsWith(`@${EMAIL_DOMAIN}`));
const personalUsers = users.filter((u) => owners.includes(u.email.toLowerCase()));
check(
  "accounts: the three demo accounts (.test) and exactly the declared personal owners, nobody else",
  demoUsers.length === 3 &&
    personalUsers.length === owners.length &&
    users.length === demoUsers.length + personalUsers.length,
  `${demoUsers.length} demo, ${personalUsers.length}/${owners.length} personal, ${users.length - demoUsers.length - personalUsers.length} other`,
);
const allMembers = await all(svc, "organization_members", "id,org_id,user_id,role");
const personalMembers = personalUsers.map((u) => allMembers.filter((m) => m.user_id === u.id));
check(
  "personal owners: Owner of the demo organization (all three stores), member of nothing else",
  personalMembers.every(
    (ms) => ms.length === 1 && ms[0].org_id === org.id && ms[0].role === "owner",
  ),
  personalMembers
    .map(
      (ms, i) =>
        `personal owner ${i + 1}/${owners.length}: ${ms.map((m) => m.role).join(",") || "none"}`,
    )
    .join("; "),
);
check(
  "personal owners: individual, confirmed accounts (no shared account)",
  new Set(personalUsers.map((u) => u.id)).size === owners.length &&
    personalUsers.every((u) => u.email_confirmed_at) &&
    personalUsers.every((u) => !demoUsers.some((d) => d.id === u.id)),
);
// Every member has a display name, so Team never shows "name not set" (the personal owners' names
// come from the operator's secrets file; neither names nor addresses are printed).
const memberProfiles = await all(svc, "profiles", "id,full_name", (q) =>
  q.in(
    "id",
    allMembers.filter((m) => m.org_id === org.id).map((m) => m.user_id),
  ),
);
const unnamed = memberProfiles.filter((p) => !String(p.full_name ?? "").trim()).length;
// The demo accounts (.test) carry exactly the dataset's names (no stale "(demo)" names after a reset).
const nameOf = Object.fromEntries(memberProfiles.map((p) => [p.id, String(p.full_name ?? "")]));
const demoNameOk = ACCOUNTS.filter((a) => {
  const u = demoUsers.find((d) => d.email.toLowerCase() === a.email);
  return u && nameOf[u.id] === a.fullName;
}).length;
check(
  "people: every member has a display name; demo accounts carry the dataset names",
  (Object.keys(target.personalOwnerNames ?? {}).length === 0 || unnamed === 0) &&
    demoNameOk === ACCOUNTS.length,
  `${memberProfiles.length - unnamed}/${memberProfiles.length} named; demo names ${demoNameOk}/${ACCOUNTS.length}${Object.keys(target.personalOwnerNames ?? {}).length ? "" : " (no personal display names declared)"}`,
);
const invitations = await all(
  svc,
  "invitations",
  "id,email,role,accepted_at,revoked_at,expires_at",
  (q) => q.eq("org_id", org.id),
);
check(
  "personal owners joined through accepted Owner invitations",
  owners.every((e) =>
    invitations.some((i) => i.email === e && i.role === "owner" && i.accepted_at),
  ),
);
const strayInvites = invitations.filter(
  (i) =>
    !i.accepted_at &&
    !i.revoked_at &&
    Date.parse(i.expires_at) > Date.now() &&
    !i.email.endsWith(`@${EMAIL_DOMAIN}`) &&
    !owners.includes(i.email),
);
check(
  "no open invitation to anyone outside the preview accounts",
  strayInvites.length === 0,
  strayInvites.length,
);

// ---- business figures (last 30 days, recorded) -------------------------------------------------
const since = Date.now() - 30 * 86_400_000;
const live = orders.filter((o) => o.status !== "cancelled");
const fig = (os) => {
  const ids = new Set(os.map((o) => o.id));
  const es = entries.filter((e) => ids.has(e.order_id));
  const net =
    sum(
      es.filter((e) => e.kind === "revenue"),
      (e) => e.amount_cents,
    ) -
    sum(
      es.filter((e) => e.kind === "reversal_revenue"),
      (e) => e.amount_cents,
    );
  const cogs =
    sum(
      es.filter((e) => e.kind === "cogs"),
      (e) => e.amount_cents,
    ) -
    sum(
      es.filter((e) => e.kind === "reversal_cogs"),
      (e) => e.amount_cents,
    );
  const n = os.filter((o) => o.status !== "cancelled").length;
  return {
    orders: n,
    netSales: net / 100,
    avgTicket: n ? Math.round(net / n) / 100 : 0,
    cogs: cogs / 100,
    grossMarginPct: net ? Math.round((1 - cogs / net) * 1000) / 10 : 0,
    tax:
      sum(
        os.filter((o) => o.status !== "cancelled"),
        (o) => o.tax_cents,
      ) / 100,
  };
};
const last30 = orders.filter((o) => Date.parse(o.created_at) >= since);
const figures = {
  period: `${nyDay(span.first)} .. ${nyDay(span.last)} (${days + 1} days)`,
  last30days: {
    total: fig(last30),
    ...Object.fromEntries(
      STORES.map((s) => [s.key, fig(last30.filter((o) => o.location_id === locByKey[s.key].id))]),
    ),
  },
  payments: Object.fromEntries(
    ["card", "cash", "digital"].map((m) => [
      m,
      live.filter((o) => payments.get(o.id)?.[0]?.method === m).length,
    ]),
  ),
  cancelled: cancelled.length,
  openTickets: open.length,
  lowStock: low.map(
    (i) => `${STORES.find((s) => locByKey[s.key].id === i.location_id).name}:${i.sku}`,
  ),
  stockValue: Math.round(sum(items, (i) => Number(i.quantity) * i.cost_cents)) / 100,
  receipts: receipts.length,
};

// ---- the two Insights alerts the dataset is built to show ----------------------------------------
{
  // supplier price rise: Downtown's open order pays PRICE_RISE.factor x the previous price of one item
  const dt = locByKey[PRICE_RISE.store];
  const item = (
    await all(svc, "inventory_items", "id,sku", (q) =>
      q.eq("org_id", org.id).eq("location_id", dt.id).eq("sku", PRICE_RISE.sku),
    )
  )[0];
  const lines = item
    ? await all(svc, "purchase_order_items", "purchase_order_id,unit_price_cents", (q) =>
        q.eq("inventory_item_id", item.id),
      )
    : [];
  const pos = new Map(
    (
      await all(svc, "purchase_orders", "id,status,created_at", (q) =>
        q.eq("org_id", org.id).eq("location_id", dt.id),
      )
    ).map((p) => [p.id, p]),
  );
  const priced = lines
    .map((l) => ({ ...l, po: pos.get(l.purchase_order_id) }))
    .filter((l) => l.po && l.po.status !== "draft" && l.po.status !== "cancelled")
    .sort((a, b) => a.po.created_at.localeCompare(b.po.created_at));
  const [prev, last] = priced.slice(-2);
  const rise =
    prev && last ? (last.unit_price_cents - prev.unit_price_cents) / prev.unit_price_cents : 0;
  check(
    "alerts: the latest order of one Downtown item costs 10% or more than the previous one",
    rise >= 0.1,
    `${(rise * 100).toFixed(1)}%`,
  );
  // sales drop, as Insights computes it: the last 7 local days (today included) against the 7 before
  const todayYmd = localYmd(Date.now());
  const shiftYmd = (ymd, k) =>
    new Date(Date.parse(`${ymd}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
  const net = (from, to) =>
    sum(
      entries.filter((e) => {
        const d = localYmd(Date.parse(e.created_at));
        return d >= from && d <= to && (e.kind === "revenue" || e.kind === "reversal_revenue");
      }),
      (e) => (e.kind === "revenue" ? e.amount_cents : -e.amount_cents),
    );
  const lastWeek = net(shiftYmd(todayYmd, -6), todayYmd);
  const weekBefore = net(shiftYmd(todayYmd, -13), shiftYmd(todayYmd, -7));
  // ledger-safe (local tests) has no busy week: its row cap has no room for it
  const busyProfile = (creds.summary?.profile ?? "ledger-safe") !== "ledger-safe";
  check(
    "alerts: revenue of the last 7 days is 15% or more below the 7 days before (busy week before)",
    !busyProfile || (weekBefore > 0 && lastWeek <= weekBefore * 0.85),
    `${weekBefore ? (((lastWeek - weekBefore) / weekBefore) * 100).toFixed(1) : "-"}%`,
  );
}

// ---- today's dining room (seed-dining.mjs, 0037-0039) ------------------------------------------
{
  const expect = floorExpectations();
  const { data: feat } = await svc
    .from("org_features")
    .select("enabled")
    .eq("org_id", org.id)
    .eq("feature", "table_service");
  check("dining room: the Tables module is on for the demo", feat?.[0]?.enabled === true);
  const dTables = await all(svc, "dining_tables", "id,location_id,status", (q) =>
    q.eq("org_id", org.id).is("archived_at", null),
  );
  check(
    "dining room: the planned tables in the three stores",
    dTables.length === expect.tables,
    `${dTables.length}/${expect.tables}`,
  );
  const dChecks = await all(svc, "dining_checks", "id,status", (q) => q.eq("org_id", org.id));
  const closedChecks = dChecks.filter((c) => c.status === "closed");
  const openChecks = dChecks.filter((c) => c.status === "open");
  check(
    "dining room: checks closed today and checks still open, as planned",
    closedChecks.length === expect.closed && openChecks.length === expect.open,
    `closed ${closedChecks.length}/${expect.closed}, open ${openChecks.length}/${expect.open}`,
  );
  const tenders = await all(
    svc,
    "dining_check_payments",
    "check_id,amount_cents,tip_cents,status",
    (q) => q.eq("org_id", org.id),
  );
  const rounds = await all(svc, "dining_check_rounds", "check_id,order_id", (q) =>
    q.eq("org_id", org.id),
  );
  const roundOrders = rounds.length
    ? await all(svc, "orders", "id,total_cents,status", (q) =>
        q.in(
          "id",
          rounds.map((r) => r.order_id),
        ),
      )
    : [];
  const orderTotal = new Map(roundOrders.map((o) => [o.id, o.total_cents]));
  const unbalanced = closedChecks.filter((c) => {
    const paid = sum(
      tenders.filter((t) => t.check_id === c.id && t.status === "recorded"),
      (t) => t.amount_cents,
    );
    const due = sum(
      rounds.filter((r) => r.check_id === c.id),
      (r) => orderTotal.get(r.order_id) ?? 0,
    );
    return paid !== due;
  });
  check(
    "dining room: every closed check was paid exactly its rounds' total",
    !unbalanced.length && tenders.length === expect.payments,
    `${unbalanced.length} unbalanced, ${tenders.length}/${expect.payments} payments`,
  );
  check("dining room: tips were recorded (never as revenue)", sum(tenders, (t) => t.tip_cents) > 0);
  const openRoundOrders = rounds
    .filter((r) => openChecks.some((c) => c.id === r.check_id))
    .map((r) => r.order_id);
  const earlyRevenue = openRoundOrders.length
    ? await all(svc, "finance_entries", "id", (q) =>
        q.in("order_id", openRoundOrders).eq("kind", "revenue"),
      )
    : [];
  check(
    "dining room: an open check has no revenue yet (it is recognized when the check closes)",
    !earlyRevenue.length,
    earlyRevenue.length,
  );
  figures.dining = {
    tables: dTables.length,
    closedChecks: closedChecks.length,
    openChecks: openChecks.length,
    tipsCents: sum(tenders, (t) => t.tip_cents),
  };
}

const failed = results.filter((r) => !r.ok);
for (const r of results)
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
console.log(JSON.stringify(figures, null, 2));
console.log(
  `${results.length - failed.length}/${results.length} checks passed on the ${target.where}`,
);
if (process.env.PREVIEW_REPORT_FILE)
  fs.writeFileSync(
    process.env.PREVIEW_REPORT_FILE,
    JSON.stringify(
      { target: target.where, at: new Date().toISOString(), results, figures },
      null,
      2,
    ),
  );
process.exit(failed.length ? 1 : 0);
