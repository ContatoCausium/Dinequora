// Executes the client-preview dataset (scripts/preview/dataset.mjs) on a destination checked by
// scripts/preview/client-preview-target.mjs, and removes it again (purge). Writes only:
//   * through the same RPCs as the UI, signed in as the demo owner (organization, stores, menu,
//     stock, recipes, suppliers, expenses, purchases + receipts, POS sales, kitchen statuses,
//     invitations), so prices, tax, stock, COGS, payments and the ledger come from the server;
//   * with the server key, three things the UI cannot do on a demo: confirmed demo accounts (Auth
//     admin API), the demo subscription (Growth, active — the demo has no billing provider, as in
//     scripts/seeds/demo/seed-demo-orgs.sql), and the history back-dating / purge functions of
//     scripts/preview/sql/client-preview-functions.sql, which only act on a demo organization.
// Generated passwords are written only to the credentials file (outside the repository, mode 600).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertResolvedTarget } from "./client-preview-target.mjs";
import {
  ACCOUNTS,
  buildDataset,
  CATEGORIES,
  DATASET_VERSION,
  EMAIL_DOMAIN,
  ORG,
  PRODUCTS,
  STOCK,
  STORES,
  SUPPLIERS,
  TIMEZONE,
} from "./dataset.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(ROOT, "package.json"));
const { createClient } = require("@supabase/supabase-js");
const NIL = "00000000-0000-0000-0000-000000000000";
const iso = (ms) => new Date(ms).toISOString();

export class SeedError extends Error {}

export function assertCredsFileOutsideRepo(file) {
  if (!file) throw new SeedError("PREVIEW_CREDS_FILE is required (a path outside the repository)");
  const abs = path.resolve(file);
  const rel = path.relative(ROOT, abs);
  if (!rel.startsWith("..") && !path.isAbsolute(rel))
    throw new SeedError("the credentials file must be outside the repository");
  return abs;
}

function clients(target) {
  assertResolvedTarget(target);
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const svc = createClient(target.apiUrl, target.serviceKey, opts);
  const signIn = async (email, password) => {
    const c = createClient(target.apiUrl, target.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new SeedError(`sign-in ${email}: ${error.message}`);
    return c;
  };
  return { svc, signIn };
}

const transient = (e) =>
  /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(String(e?.message ?? e));
/** RPC call. `idempotent` calls are retried on network errors only (never on a server answer). */
async function rpc(client, fn, args, { idempotent = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await client.rpc(fn, args);
    } catch (e) {
      if (idempotent && attempt < 4 && transient(e)) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw e;
    }
    if (res.error) {
      if (idempotent && attempt < 4 && transient(res.error)) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw new SeedError(
        `${fn}: ${res.error.message}${res.error.details ? ` (${res.error.details})` : ""}`,
      );
    }
    return res.data;
  }
}
async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new SeedError(`${what}: ${error.message}`);
  return data;
}

async function demoAccounts(svc) {
  const found = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new SeedError(`listUsers: ${error.message}`);
    found.push(
      ...data.users.filter((u) => (u.email ?? "").toLowerCase().endsWith(`@${EMAIL_DOMAIN}`)),
    );
    if (data.users.length < 200) break;
  }
  return found;
}
async function demoOrganizations(svc) {
  return must(
    svc.from("organizations").select("id,slug").eq("name", ORG.name).eq("is_demo", true),
    "organizations",
  );
}

const hoursOf = (store) => {
  const pad = (n) => String(n).padStart(2, "0");
  const span = {
    open: `${pad(store.open[0])}:${pad(store.open[1])}`,
    close: `${pad(store.close[0])}:${pad(store.close[1])}`,
  };
  return Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, span]),
  );
};

/** Removes the demo organization(s) and the demo accounts. */
export async function purgeClientPreview(target, { log = console.log } = {}) {
  const { svc } = clients(target);
  const removed = [];
  for (const org of await demoOrganizations(svc))
    removed.push(await rpc(svc, "client_preview_purge", { _org_id: org.id }));
  const accounts = await demoAccounts(svc);
  for (const u of accounts) {
    const { error } = await svc.auth.admin.deleteUser(u.id);
    if (error) throw new SeedError(`deleteUser: ${error.message}`);
  }
  log(`purged ${removed.length} demo organization(s) and ${accounts.length} demo account(s)`);
  return { organizations: removed, accounts: accounts.length };
}

/** Seeds the dataset. Refuses when the demo organization or demo accounts already exist. */
export async function seedClientPreview(
  target,
  { now = Date.now(), profile = "ledger-safe", credsFile, log = console.log, concurrency = 3 } = {},
) {
  const credsPath = assertCredsFileOutsideRepo(credsFile);
  const { svc, signIn } = clients(target);
  if ((await demoOrganizations(svc)).length)
    throw new SeedError("the demo organization already exists (use reset)");
  if ((await demoAccounts(svc)).length)
    throw new SeedError("demo accounts already exist (use reset)");

  const plan = buildDataset({ now, profile });
  log(
    `dataset profile ${profile}: ${plan.summary.orders} orders over ${plan.summary.days + 1} days, ~${plan.summary.ledgerEntries} ledger entries`,
  );
  const started = Date.now();
  const creds = {
    kind: "dinequora-client-preview",
    datasetVersion: DATASET_VERSION,
    target: target.where,
    apiUrl: target.apiUrl,
    accounts: {},
  };
  const save = () => fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  // The credentials file must be writable before anything is created, or passwords would be lost.
  try {
    save();
  } catch (e) {
    throw new SeedError(`cannot write the credentials file (${e.code ?? e.message})`);
  }

  // 1. Accounts (confirmed; passwords only in the credentials file).
  for (const a of ACCOUNTS) {
    const password = `${crypto.randomBytes(15).toString("base64url")}!7a`;
    const { data, error } = await svc.auth.admin.createUser({
      email: a.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: a.fullName, preferred_language: "en-US" },
    });
    if (error) throw new SeedError(`createUser ${a.email}: ${error.message}`);
    creds.accounts[a.key] = { email: a.email, password, userId: data.user.id, role: a.role };
    save();
  }
  const owner = await signIn(creds.accounts.owner.email, creds.accounts.owner.password);

  // 2. Organization (onboarding path: classified as demo), plan, brand, stores.
  const orgId = await rpc(owner, "create_test_restaurant", {
    _name: ORG.name,
    _company_name: ORG.companyName,
    _company_address: ORG.companyAddress,
    _location_name: STORES[0].name,
  });
  await must(
    svc
      .from("subscriptions")
      .update({
        plan_id: ORG.plan,
        status: "active",
        trial_ends_at: null,
        grace_ends_at: null,
        billed_locations: STORES.length,
      })
      .eq("org_id", orgId),
    "demo subscription",
  );
  const limit = await rpc(svc, "effective_store_limit", { _org_id: orgId });
  if (limit < STORES.length) throw new SeedError(`store limit ${limit} < ${STORES.length}`);
  await rpc(owner, "save_org_brand", {
    _org_id: orgId,
    _primary: ORG.brandPrimary,
    _accent: ORG.brandAccent,
    _logo: null,
  });
  const org = await must(
    owner.from("organizations").select("slug").eq("id", orgId).single(),
    "org slug",
  );
  const first = await must(owner.from("locations").select("id").eq("org_id", orgId), "first store");
  if (first.length !== 1) throw new SeedError("expected exactly one store after onboarding");
  const loc = { [STORES[0].key]: first[0].id };
  await rpc(owner, "set_location_tax_rate", {
    _location_id: loc[STORES[0].key],
    _tax_rate_ppm: STORES[0].taxRatePpm,
  });
  for (const s of STORES.slice(1))
    loc[s.key] = await rpc(owner, "create_location_with_tax_rate", {
      _org_id: orgId,
      _name: s.name,
      _address: s.address,
      _timezone: TIMEZONE,
      _phone: s.phone,
      _tax_rate_ppm: s.taxRatePpm,
    });
  for (const s of STORES)
    await rpc(owner, "update_location", {
      _id: loc[s.key],
      _name: s.name,
      _address: s.address,
      _phone: s.phone,
      _timezone: TIMEZONE,
      _hours: hoursOf(s),
    });
  Object.assign(creds, { org: { id: orgId, slug: org.slug, name: ORG.name }, stores: loc });
  save();
  log(`organization ${org.slug} with stores ${STORES.map((s) => s.name).join(", ")}`);

  // 3. Menu.
  for (const c of CATEGORIES)
    await rpc(owner, "save_operational_menu", {
      _org_id: orgId,
      _kind: "category",
      _payload: { op: "create", id: c.id, name: c.name },
    });
  for (const p of PRODUCTS)
    await rpc(owner, "save_operational_menu", {
      _org_id: orgId,
      _kind: "product",
      _payload: {
        id: p.id,
        orgId: org.slug,
        name: p.name,
        description: p.description,
        category: p.category,
        priceCents: p.priceCents,
        prepTimeMinutes: p.prep,
        imageUrl: "",
        notes: "",
        active: true,
        locationIds: STORES.filter((s) => !(p.notAt ?? []).includes(s.key)).map((s) => loc[s.key]),
        modifierGroups: p.modifiers,
        createdAt: iso(plan.openingsAt),
      },
    });

  // 4. Suppliers, stock (opening quantities), recipes, expenses.
  const supplierId = {};
  for (const s of SUPPLIERS)
    supplierId[s.key] = await rpc(owner, "save_operational_record", {
      _org_id: orgId,
      _location_id: NIL,
      _kind: "supplier",
      _payload: { name: s.name, notes: s.notes, active: true },
    });
  const itemId = {};
  for (const store of STORES) {
    const sp = plan.stockPlan[store.key];
    itemId[store.key] = {};
    for (const s of STOCK)
      itemId[store.key][s.sku] = await rpc(owner, "save_operational_record", {
        _org_id: orgId,
        _location_id: loc[store.key],
        _kind: "inventory",
        _payload: {
          name: s.name,
          category: s.category,
          sku: s.sku,
          unit: s.unit,
          quantity: sp.opening[s.sku],
          minQuantity: sp.minQuantity[s.sku],
          costCents: s.costCents,
          supplier: SUPPLIERS.find((x) => x.key === s.supplier).name,
          active: true,
        },
      });
    for (const p of PRODUCTS.filter((x) => !(x.notAt ?? []).includes(store.key)))
      await rpc(owner, "save_operational_record", {
        _org_id: orgId,
        _location_id: loc[store.key],
        _kind: "recipe",
        _payload: {
          productId: p.id,
          servings: 1,
          yieldQuantity: 1,
          ingredients: p.recipe.map(([sku, quantity, unit, waste]) => ({
            inventoryItemId: itemId[store.key][sku],
            quantity,
            unit,
            wastePercentage: waste,
          })),
        },
      });
  }
  for (const e of plan.expenses)
    await rpc(owner, "save_operational_record", {
      _org_id: orgId,
      _location_id: loc[e.store],
      _kind: "expense",
      _payload: e.payload,
    });
  log(
    `menu ${PRODUCTS.length} products, ${STOCK.length} stock items x ${STORES.length} stores, recipes, ${plan.expenses.length} expenses`,
  );

  // 5. Business history, in business-time order per store (stores run in parallel lanes).
  const backdate = { orders: [], receipts: [] };
  let done = 0;
  const lane = async (storeKey) => {
    const L = loc[storeKey];
    const store = STORES.find((s) => s.key === storeKey);
    for (const ev of plan.events.filter((x) => x.store === storeKey)) {
      if (ev.kind === "receipt") {
        const rc = ev.receipt;
        const poId = await rpc(owner, "save_operational_record", {
          _org_id: orgId,
          _location_id: L,
          _kind: "purchase",
          _payload: {
            supplierId: supplierId[rc.supplier],
            status: "sent",
            discountCents: 0,
            taxCents: 0,
            shippingCents: 0,
            notes: "Weekly order (demo)",
            items: rc.items.map((i) => ({
              inventoryItemId: itemId[storeKey][i.sku],
              quantityOrdered: i.quantity,
              unitPriceCents: i.unitPriceCents,
            })),
          },
        });
        const lines = await must(
          owner
            .from("purchase_order_items")
            .select("id,quantity_ordered")
            .eq("purchase_order_id", poId),
          "purchase lines",
        );
        const receiptId = await rpc(
          owner,
          "receive_operational_purchase",
          {
            _purchase_id: poId,
            _items: lines.map((l) => ({ itemId: l.id, receivedNow: Number(l.quantity_ordered) })),
            _client_event_id: `cp-receipt-${rc.key}`,
            _notes: "Received in full (demo)",
          },
          { idempotent: true },
        );
        backdate.receipts.push({
          id: receiptId,
          purchase_id: poId,
          ordered_at: iso(rc.orderedAt),
          received_at: iso(rc.receivedAt),
        });
        continue;
      }
      const s = ev.sale;
      const orderId = await rpc(
        owner,
        "persist_finalized_pos_sale_atomic_v2",
        {
          _org_id: orgId,
          _location_id: L,
          _type: s.type,
          _customer_name: s.customerName,
          _customer_phone: s.customerPhone,
          _customer_email: "",
          _delivery_address: s.deliveryAddress,
          _table_number: s.tableNumber,
          _notes: "",
          _discount_cents: s.discountCents,
          _tax_rate_ppm: store.taxRatePpm,
          _is_simulation: false,
          _client_order_id: s.clientOrderId,
          _items: s.items.map((i) => ({
            product_id: i.productId,
            quantity: i.quantity,
            notes: "",
            modifiers: i.modifiers.map((m) => ({ group_id: m.groupId, option_id: m.optionId })),
          })),
          _payment_method: s.payment,
        },
        { idempotent: true },
      );
      for (const st of s.steps)
        await rpc(
          owner,
          "update_order_status",
          {
            _order_id: orderId,
            _new_status: st.status,
            _reason:
              st.status === "cancelled" ? "Customer changed the order (demo)" : "Kitchen (demo)",
          },
          { idempotent: st.status !== "cancelled" },
        );
      backdate.orders.push({
        id: orderId,
        at: iso(s.at),
        steps: s.steps.map((st) => ({ status: st.status, at: iso(st.at) })),
      });
      if (++done % 500 === 0) log(`  ${done} orders recorded`);
    }
  };
  const keys = STORES.map((s) => s.key);
  for (let i = 0; i < keys.length; i += concurrency)
    await Promise.all(keys.slice(i, i + concurrency).map(lane));
  log(
    `${backdate.orders.length} orders and ${backdate.receipts.length} receipts recorded through the POS and purchasing RPCs`,
  );

  // Closing check: the planned alert items lose what spoiled (inventory "loss", as on the stock
  // screen), ending with 30 servings — below their minimum (alerts show) yet sellable in a live demo.
  for (const store of STORES)
    for (const sku of plan.stockPlan[store.key].lowAtEnd) {
      const it = await must(
        owner
          .from("inventory_items")
          .select("id,quantity,min_quantity")
          .eq("id", itemId[store.key][sku])
          .single(),
        "stock item",
      );
      const desired = plan.stockPlan[store.key].alertKeep[sku];
      const loss = Math.round((Number(it.quantity) - desired) * 100) / 100;
      if (loss > 0)
        await rpc(
          owner,
          "record_operational_movement",
          {
            _org_id: orgId,
            _location_id: loc[store.key],
            _item_id: it.id,
            _type: "loss",
            _quantity: loss,
            _reason: "Spoilage at the closing check (demo)",
            _client_event_id: `cp-loss-${store.key}-${sku}`,
          },
          { idempotent: true },
        );
    }

  // 6. One open purchase order per store (sent, waiting for delivery).
  for (const store of STORES) {
    const po = plan.stockPlan[store.key].openPo;
    await rpc(owner, "save_operational_record", {
      _org_id: orgId,
      _location_id: loc[store.key],
      _kind: "purchase",
      _payload: {
        supplierId: supplierId[po.supplier],
        status: "sent",
        discountCents: 0,
        taxCents: 0,
        shippingCents: 0,
        notes: "Next delivery (demo)",
        items: po.items.map((i) => ({
          inventoryItemId: itemId[store.key][i.sku],
          quantityOrdered: i.quantity,
          unitPriceCents: i.unitPriceCents,
        })),
      },
    });
  }

  // 7. Business times.
  const counts = { orders: 0, receipts: 0, openings: 0 };
  for (let i = 0; i < backdate.orders.length; i += 250) {
    const r = await rpc(svc, "client_preview_backdate", {
      _org_id: orgId,
      _plan: { orders: backdate.orders.slice(i, i + 250) },
    });
    counts.orders += r.orders;
  }
  const r2 = await rpc(svc, "client_preview_backdate", {
    _org_id: orgId,
    _plan: { receipts: backdate.receipts, openings_at: iso(plan.openingsAt) },
  });
  counts.receipts += r2.receipts;
  counts.openings += r2.openings;
  log(
    `history back-dated: ${counts.orders} orders, ${counts.receipts} receipts, ${counts.openings} opening movements`,
  );

  // 8. Team (invited and accepted through the real flow) and onboarding.
  const profiles = await must(
    owner.from("permission_profiles").select("id,key").eq("is_system", true),
    "profiles",
  );
  const P = Object.fromEntries(profiles.map((p) => [p.key, p.id]));
  for (const a of ACCOUNTS.filter((x) => x.role !== "owner")) {
    const token = await rpc(owner, "create_invitation", {
      _org_id: orgId,
      _email: a.email,
      _role: a.role,
      _location_ids: a.stores.map((k) => loc[k]),
      _profile_id: a.profile ? P[a.profile] : null,
    });
    const member = await signIn(creds.accounts[a.key].email, creds.accounts[a.key].password);
    await rpc(member, "accept_invitation", { _token: token });
  }
  let onboarding = "complete";
  try {
    await rpc(owner, "set_onboarding_step", { _org_id: orgId, _step: 5 });
  } catch (e) {
    onboarding = `not completed: ${e.message}`;
  }

  creds.seededAt = new Date().toISOString();
  creds.anchorNow = iso(now);
  creds.summary = {
    ...plan.summary,
    startYmd: plan.startYmd,
    todayYmd: plan.todayYmd,
    onboarding,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  save();
  log(
    `client-preview dataset ready on ${target.where} in ${creds.summary.seconds}s (credentials in the credentials file; passwords not printed)`,
  );
  return { orgId, slug: org.slug, stores: loc, summary: creds.summary, credsPath };
}
