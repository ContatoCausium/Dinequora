// Permission / store-scope / tenant-isolation regression (0018-0020). LOCAL/CI Supabase ONLY.
//
// Default target: the isolated QA tenant on the disposable QA stack (port 55321), seeded by
// scripts/qa/seed-qa-org.mjs. Usage (repo root):
//   SB_URL=http://127.0.0.1:55321 SB_ANON=<qa anon key> SB_SERVICE=<qa service key> \
//   CREDS_FILE=<path outside the repo> node scripts/security/permission_matrix.mjs
// CREDS_FILE: { orgId, locations:{downtown,riverside}, owner, admin, team:{manager},
//   roles:{<email>:{userId,password}}, emails:{cashier,kitchen,stock,finance},
//   fixtures:{sodaSku,productId,otherOrgSlug} }. Never commit it.
// The suite performs real writes in the target org (sales, a stock entry, a receipt, an
// expense), so it refuses the commercial demo stack (54321) unless ALLOW_DEMO_WRITES=1 is set
// explicitly, and refuses every other URL.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const URL_ = process.env.SB_URL;
const QA_STACK = /^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(URL_ ?? "");
const DEMO_STACK = /^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(URL_ ?? "");
if (!QA_STACK && !DEMO_STACK)
  throw new Error("Refusing: SB_URL must be the local QA stack (55321)");
if (DEMO_STACK && process.env.ALLOW_DEMO_WRITES !== "1")
  throw new Error(
    "Refusing: 54321 is the commercial demo and this suite writes data; use the QA stack",
  );
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const serviceClient = () => createClient(URL_, process.env.SB_SERVICE, opts);
async function signedIn(email, password) {
  const c = createClient(URL_, process.env.SB_ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}
// Owner session without using (or changing) the owner's password: a one-time magic-link token
// generated locally with the service role (no e-mail is sent). The owner may have changed the
// password through the recovery flow, so the stored one is only tried first.
async function ownerSession() {
  const c = createClient(URL_, process.env.SB_ANON, opts);
  if (
    !(await c.auth.signInWithPassword({ email: creds.owner.email, password: creds.owner.password }))
      .error
  )
    return c;
  const { data, error } = await serviceClient().auth.admin.generateLink({
    type: "magiclink",
    email: creds.owner.email,
  });
  if (error) throw new Error("owner session: " + error.message);
  const v = await c.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (v.error) throw new Error("owner session: " + v.error.message);
  return c;
}
const loadCreds = () => JSON.parse(fs.readFileSync(process.env.CREDS_FILE, "utf8"));
const creds = loadCreds();
const ORG = creds.orgId;
// Fixture names default to the original demo seed so an older CREDS_FILE keeps working.
const EMAIL = {
  cashier: creds.emails?.cashier ?? "caixa.downtown@servora.test",
  kitchen: creds.emails?.kitchen ?? "cozinha.riverside@servora.test",
  stock: creds.emails?.stock ?? "estoque.downtown@servora.test",
  finance: creds.emails?.finance ?? "financeiro@servora.test",
};
const SODA_SKU = creds.fixtures?.sodaSku ?? "AUR-SODA";
const PRODUCT = creds.fixtures?.productId ?? "prod-soda";
const OTHER_ORG_SLUG = creds.fixtures?.otherOrgSlug ?? "org-alpha";
const L = creds.locations; // downtown / riverside uuids
const svc = serviceClient();
const as = async (email) =>
  signedIn(
    email,
    email === creds.team?.manager?.email
      ? creds.team.manager.password
      : creds.roles[email].password,
  );
const results = [];
const check = (name, ok, detail = "") => results.push({ ok, name, detail });

async function count(c, table, filter = {}) {
  let q = c.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { count: n, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}
async function call(c, fn, args) {
  const { data, error } = await c.rpc(fn, args);
  return error ? { error: error.message, detail: error.details } : { data };
}
const expectAllow = (name, r) =>
  check(name, !r.error, r.error ? `${r.error} ${r.detail ?? ""}` : "allowed");
const expectDeny = (name, r, code = "permission_denied") =>
  check(name, r.error === code, r.error ? `${r.error} ${r.detail ?? ""}` : "UNEXPECTEDLY ALLOWED");

// Reference data (service role, read only)
const { data: alpha } = await svc
  .from("organizations")
  .select("id")
  .eq("slug", OTHER_ORG_SLUG)
  .single();
const { data: alphaLoc } = await svc
  .from("locations")
  .select("id")
  .eq("org_id", alpha.id)
  .limit(1)
  .single();
// A fresh, unpaid Riverside ticket created by the store manager (who may sell there), so the
// kitchen checks never depend on leftovers from previous runs.
const mgr = await signedIn(creds.team.manager.email, creds.team.manager.password);
const { data: rvOrderId, error: rvErr } = await mgr.rpc("create_pos_sale", {
  _org_id: ORG,
  _location_id: L.riverside,
  _type: "dine_in",
  _customer_name: "Kitchen test",
  _items: [{ product_id: PRODUCT, quantity: 1, modifiers: [] }],
  _discount_cents: 0,
  _tax_rate_basis_points: 0,
  _is_simulation: false,
  _client_order_id: `perm-kitchen-${Date.now()}`,
});
if (rvErr) throw new Error("setup: " + rvErr.message);
const rvOrder = { id: rvOrderId };
const { data: dtOrder } = await svc
  .from("orders")
  .select("id")
  .eq("location_id", L.downtown)
  .eq("status", "delivered")
  .limit(1)
  .single();
const { data: item } = await svc
  .from("order_items")
  .select("id")
  .eq("order_id", rvOrder.id)
  .limit(1)
  .single();
const { data: dtSoda } = await svc
  .from("inventory_items")
  .select("id")
  .eq("location_id", L.downtown)
  .eq("sku", SODA_SKU)
  .single();
const { data: rvSoda } = await svc
  .from("inventory_items")
  .select("id")
  .eq("location_id", L.riverside)
  .eq("sku", SODA_SKU)
  .single();
const { data: sentPo } = await svc
  .from("purchase_orders")
  .select("id,purchase_order_items(id,quantity_ordered,quantity_received,unit_price_cents)")
  .eq("location_id", L.downtown)
  .in("status", ["sent", "partially_received"])
  .limit(1)
  .single();
const { data: supplier } = await svc
  .from("suppliers")
  .select("id")
  .eq("org_id", ORG)
  .limit(1)
  .single();
const members = Object.fromEntries(
  (await svc.from("organization_members").select("id,user_id,role").eq("org_id", ORG)).data.map(
    (m) => [m.user_id, m],
  ),
);
const sale = (loc, cid, discount = 0) => ({
  _org_id: ORG,
  _location_id: loc,
  _type: "takeout",
  _customer_name: "Permission test",
  _items: [{ product_id: PRODUCT, quantity: 1, modifiers: [] }],
  _discount_cents: discount,
  _tax_rate_basis_points: 0,
  _is_simulation: false,
  _client_order_id: cid,
  _payment_method: "cash",
});
const stamp = Date.now();

// ---------------- Cashier (Downtown)
{
  const c = await as(EMAIL.cashier);
  check(
    "cashier reads Downtown orders",
    (await count(c, "orders", { location_id: L.downtown })) > 0,
  );
  check(
    "cashier cannot read Riverside orders",
    (await count(c, "orders", { location_id: L.riverside })) === 0,
  );
  for (const t of [
    "finance_entries",
    "finance_expenses",
    "purchase_orders",
    "inventory_items",
    "audit_logs",
  ])
    check(
      `cashier cannot read ${t}`,
      (await count(c, t, t === "audit_logs" ? { org_id: ORG } : {})) === 0,
    );
  expectAllow(
    "cashier sells at Downtown",
    await call(c, "persist_finalized_pos_sale_atomic", sale(L.downtown, `perm-cashier-${stamp}`)),
  );
  expectAllow(
    "cashier applies a discount (pos.discount)",
    await call(
      c,
      "persist_finalized_pos_sale_atomic",
      sale(L.downtown, `perm-cashier-d-${stamp}`, 50),
    ),
  );
  expectDeny(
    "cashier cannot sell at Riverside (store scope)",
    await call(
      c,
      "persist_finalized_pos_sale_atomic",
      sale(L.riverside, `perm-cashier-rv-${stamp}`),
    ),
    "forbidden",
  );
  expectDeny(
    "cashier cannot refund/cancel (orders.refund)",
    await call(c, "cancel_order_with_reversal", { _order_id: dtOrder.id, _reason: "test" }),
  );
  expectDeny(
    "cashier cannot adjust stock",
    await call(c, "record_operational_movement", {
      _org_id: ORG,
      _location_id: L.downtown,
      _item_id: dtSoda.id,
      _type: "in",
      _quantity: 1,
      _reason: "test",
      _client_event_id: `perm-c-${stamp}`,
    }),
  );
  expectDeny(
    "cashier cannot create expenses",
    await call(c, "save_operational_record", {
      _org_id: ORG,
      _location_id: L.downtown,
      _kind: "expense",
      _payload: {
        category: "other",
        recurrence: "variable",
        status: "pending",
        description: "x",
        amountCents: 100,
        dueDate: "2026-11-30",
        competencyDate: "2026-11-01",
        responsiblePerson: "x",
      },
    }),
  );
  expectDeny(
    "cashier cannot sell in another organization",
    await call(c, "persist_finalized_pos_sale_atomic", {
      ...sale(alphaLoc.id, `perm-x-${stamp}`),
      _org_id: alpha.id,
    }),
    "forbidden",
  );
  check(
    "cashier cannot read another organization's orders",
    (await count(c, "orders", { org_id: alpha.id })) === 0,
  );
  const { data: last } = await svc
    .from("audit_logs")
    .select("action,location_id,actor_id,result")
    .eq("org_id", ORG)
    .eq("action", "pos.finalized")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  check(
    "audit records actor, store and result for the cashier sale",
    last.location_id === L.downtown &&
      last.actor_id === creds.roles[EMAIL.cashier].userId &&
      last.result === "success",
    JSON.stringify(last),
  );
  await call(c, "log_access_denied", {
    _org_id: ORG,
    _action: "orders.refund",
    _location_id: L.downtown,
    _detail: "orders.refund",
  });
  const { data: den } = await svc
    .from("audit_logs")
    .select("result,location_id")
    .eq("actor_id", creds.roles[EMAIL.cashier].userId)
    .eq("result", "denied")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  check(
    "denied attempt is recorded with store",
    den?.result === "denied" && den.location_id === L.downtown,
    JSON.stringify(den),
  );
  await call(c, "log_access_denied", { _org_id: alpha.id, _action: "probe" });
  check(
    "denial log ignores organizations the user is not in",
    (
      await svc
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", alpha.id)
        .eq("result", "denied")
    ).count === 0,
  );
}
// ---------------- Kitchen (Riverside)
{
  const c = await as(EMAIL.kitchen);
  check(
    "kitchen reads Riverside orders",
    (await count(c, "orders", { location_id: L.riverside })) > 0,
  );
  check(
    "kitchen cannot read Downtown orders",
    (await count(c, "orders", { location_id: L.downtown })) === 0,
  );
  check("kitchen reads Riverside recipes", (await count(c, "product_recipes")) > 0);
  check("kitchen cannot read finance", (await count(c, "finance_entries")) === 0);
  expectAllow(
    "kitchen marks an item ready",
    await call(c, "set_order_item_ready", { _item_id: item.id, _ready: true }),
  );
  expectAllow(
    "kitchen starts preparing an order",
    await call(c, "update_order_status", {
      _order_id: rvOrder.id,
      _new_status: "in_prep",
      _reason: "Permission test",
    }),
  );
  expectDeny(
    "kitchen cannot sell",
    await call(c, "persist_finalized_pos_sale_atomic", sale(L.riverside, `perm-k-${stamp}`)),
  );
  expectDeny(
    "kitchen cannot cancel orders",
    await call(c, "cancel_order_with_reversal", { _order_id: rvOrder.id, _reason: "test" }),
  );
}
// ---------------- Stock keeper (Downtown)
{
  const c = await as(EMAIL.stock);
  check(
    "stock keeper reads Downtown inventory",
    (await count(c, "inventory_items", { location_id: L.downtown })) > 0,
  );
  check(
    "stock keeper cannot read Riverside inventory",
    (await count(c, "inventory_items", { location_id: L.riverside })) === 0,
  );
  check("stock keeper reads Downtown purchase orders", (await count(c, "purchase_orders")) > 0);
  check(
    "stock keeper cannot read orders or finance",
    (await count(c, "orders")) === 0 && (await count(c, "finance_entries")) === 0,
  );
  expectAllow(
    "stock keeper records a stock entry (staff tier, granted)",
    await call(c, "record_operational_movement", {
      _org_id: ORG,
      _location_id: L.downtown,
      _item_id: dtSoda.id,
      _type: "in",
      _quantity: 6,
      _reason: "Permission test delivery",
      _client_event_id: `perm-s-${stamp}`,
    }),
  );
  expectDeny(
    "stock keeper cannot move Riverside stock",
    await call(c, "record_operational_movement", {
      _org_id: ORG,
      _location_id: L.riverside,
      _item_id: rvSoda.id,
      _type: "in",
      _quantity: 1,
      _reason: "x",
      _client_event_id: `perm-s2-${stamp}`,
    }),
    "forbidden",
  );
  const line = sentPo.purchase_order_items.find((i) => i.quantity_received < i.quantity_ordered);
  expectAllow(
    "stock keeper receives a sent purchase order",
    await call(c, "receive_operational_purchase", {
      _purchase_id: sentPo.id,
      _client_event_id: `perm-r-${stamp}`,
      _notes: "Permission test",
      _items: [
        {
          itemId: line.id,
          receivedNow: 1,
          priceVerifiedCents: line.unit_price_cents,
          divergenceReason: "",
        },
      ],
    }),
  );
  expectAllow(
    "stock keeper creates a draft purchase order",
    await call(c, "save_operational_record", {
      _org_id: ORG,
      _location_id: L.downtown,
      _kind: "purchase",
      _payload: {
        supplierId: supplier.id,
        status: "draft",
        notes: "Permission test",
        items: [{ inventoryItemId: dtSoda.id, quantityOrdered: 24, unitPriceCents: 60 }],
      },
    }),
  );
  expectDeny(
    "stock keeper cannot approve/send a purchase order",
    await call(c, "save_operational_record", {
      _org_id: ORG,
      _location_id: L.downtown,
      _kind: "purchase",
      _payload: {
        supplierId: supplier.id,
        status: "sent",
        notes: "x",
        items: [{ inventoryItemId: dtSoda.id, quantityOrdered: 1, unitPriceCents: 60 }],
      },
    }),
  );
  expectDeny(
    "stock keeper cannot create expenses",
    await call(c, "save_operational_record", {
      _org_id: ORG,
      _location_id: L.downtown,
      _kind: "expense",
      _payload: {
        category: "other",
        recurrence: "variable",
        status: "pending",
        description: "x",
        amountCents: 1,
        dueDate: "2026-11-30",
        competencyDate: "2026-11-01",
        responsiblePerson: "x",
      },
    }),
  );
}
// ---------------- Finance (both stores)
{
  const c = await as(EMAIL.finance);
  check(
    "finance reads ledger for both stores",
    (await count(c, "finance_entries", { location_id: L.downtown })) > 0 &&
      (await count(c, "finance_entries", { location_id: L.riverside })) > 0,
  );
  check("finance cannot read team activity", (await count(c, "audit_logs", { org_id: ORG })) === 0);
  const exp = {
    category: "internet",
    recurrence: "recurring",
    status: "pending",
    description: "Fiber internet (permission test)",
    amountCents: 12900,
    dueDate: "2026-11-25",
    competencyDate: "2026-11-01",
    responsiblePerson: "Renata Costa (Demo)",
    isSimulation: false,
    active: true,
  };
  const created = await call(c, "save_operational_record", {
    _org_id: ORG,
    _location_id: L.riverside,
    _kind: "expense",
    _payload: exp,
  });
  expectAllow("finance creates an expense", created);
  expectAllow(
    "finance marks it as paid (expenses.pay)",
    await call(c, "save_operational_record", {
      _org_id: ORG,
      _location_id: L.riverside,
      _kind: "expense",
      _payload: { ...exp, id: created.data, status: "paid", paidAt: new Date().toISOString() },
    }),
  );
  expectDeny(
    "finance cannot delete expenses (not in profile)",
    await call(c, "save_operational_record", {
      _org_id: ORG,
      _location_id: L.riverside,
      _kind: "expense",
      _payload: { ...exp, id: created.data, status: "paid", active: false },
    }),
  );
  expectDeny(
    "finance cannot sell",
    await call(c, "persist_finalized_pos_sale_atomic", sale(L.downtown, `perm-f-${stamp}`)),
  );
}
// ---------------- Manager (Riverside)
{
  const c = await as(creds.team.manager.email);
  check(
    "manager reads Riverside finance",
    (await count(c, "finance_entries", { location_id: L.riverside })) > 0,
  );
  check(
    "manager cannot read Downtown finance",
    (await count(c, "finance_entries", { location_id: L.downtown })) === 0,
  );
  check("manager reads team activity", (await count(c, "audit_logs", { org_id: ORG })) > 0);
  const kitchen = members[creds.roles[EMAIL.kitchen].userId];
  const cashier = members[creds.roles[EMAIL.cashier].userId];
  const { data: kprof } = await svc
    .from("organization_members")
    .select("profile_id")
    .eq("id", kitchen.id)
    .single();
  expectAllow(
    "manager grants an extra permission to Riverside kitchen staff",
    await call(c, "set_member_access", {
      _member_id: kitchen.id,
      _role: "staff",
      _profile_id: kprof.profile_id,
      _extra: ["inventory.adjust"],
      _revoked: [],
      _location_ids: [L.riverside],
    }),
  );
  const { data: kp } = await c.rpc("my_permissions", { _org_id: ORG });
  // 44 catalog permissions (0020) minus branding, billing and suppliers.edit.
  check(
    "manager sanity: own permissions loaded",
    Array.isArray(kp) && kp.length === 41 && kp.includes("inventory.costs"),
    String(kp?.length),
  );
  expectDeny(
    "manager cannot edit Downtown staff (outside his stores)",
    await call(c, "set_member_access", {
      _member_id: cashier.id,
      _role: "staff",
      _profile_id: null,
      _extra: [],
      _revoked: [],
      _location_ids: [L.downtown],
    }),
    "forbidden",
  );
  expectDeny(
    "manager cannot grant what he does not have (suppliers.edit)",
    await call(c, "set_member_access", {
      _member_id: kitchen.id,
      _role: "staff",
      _profile_id: kprof.profile_id,
      _extra: ["suppliers.edit"],
      _revoked: [],
      _location_ids: [L.riverside],
    }),
    "permission_exceeds_own",
  );
  expectDeny(
    "manager cannot promote staff to manager",
    await call(c, "set_member_access", {
      _member_id: kitchen.id,
      _role: "manager",
      _profile_id: null,
      _extra: [],
      _revoked: [],
      _location_ids: [L.riverside],
    }),
    "forbidden",
  );
  expectDeny(
    "manager cannot change the owner",
    await call(c, "set_member_access", {
      _member_id: members[creds.owner.userId].id,
      _role: "staff",
      _profile_id: null,
      _extra: [],
      _revoked: [],
      _location_ids: [],
    }),
    "forbidden",
  );
  expectDeny(
    "manager cannot create permission profiles",
    await call(c, "save_permission_profile", {
      _org_id: ORG,
      _id: null,
      _name: "Hack",
      _description: "",
      _tier: "manager",
      _permissions: ["settings.billing"],
    }),
    "forbidden",
  );
  // restore the kitchen profile exactly (no extras)
  await call(c, "set_member_access", {
    _member_id: kitchen.id,
    _role: "staff",
    _profile_id: kprof.profile_id,
    _extra: [],
    _revoked: [],
    _location_ids: [L.riverside],
  });
  const staffCeil = (await svc.rpc("role_ceiling", { _role: "staff" })).data;
  check(
    "staff tier ceiling never includes team.* or settings.*",
    !staffCeil.some((p) => p.startsWith("team.") || p.startsWith("settings.")),
  );
}
// ---------------- Inventory costs (migration 0020): every profile, positive and negative
{
  const accounts = [
    { label: "owner", c: await ownerSession(), costs: "all" },
    { label: "manager", c: mgr, costs: [L.riverside] },
    { label: "cashier", c: await as(EMAIL.cashier), costs: null },
    { label: "kitchen", c: await as(EMAIL.kitchen), costs: null },
    { label: "stock", c: await as(EMAIL.stock), costs: [L.downtown] },
    { label: "finance", c: await as(EMAIL.finance), costs: [L.downtown, L.riverside] },
  ];
  const { data: allItems } = await svc
    .from("inventory_items")
    .select("id,location_id,cost_cents")
    .eq("org_id", ORG);
  const itemLoc = new Map(allItems.map((i) => [i.id, i.location_id]));
  const realCost = new Map(allItems.map((i) => [i.id, i.cost_cents]));
  const { data: someMoves } = await svc
    .from("inventory_movements")
    .select("id,location_id,unit_cost_cents")
    .eq("org_id", ORG)
    .order("created_at", { ascending: false })
    .limit(400);
  const moveIds = [
    ...(someMoves ?? []).filter((m) => m.location_id === L.downtown).slice(0, 20),
    ...(someMoves ?? []).filter((m) => m.location_id === L.riverside).slice(0, 20),
  ];
  const moveLoc = new Map(moveIds.map((m) => [m.id, m.location_id]));
  const denied = (r) => Boolean(r.error) && /permission denied/i.test(r.error.message);
  for (const { label, c, costs } of accounts) {
    // Direct table access: the cost columns are not readable by ANY client role, owners included.
    check(
      `${label}: cannot select inventory_items.cost_cents directly`,
      denied(await c.from("inventory_items").select("id,cost_cents").eq("org_id", ORG).limit(1)),
    );
    check(
      `${label}: cannot select * from inventory_items (would include cost)`,
      denied(await c.from("inventory_items").select("*").eq("org_id", ORG).limit(1)),
    );
    check(
      `${label}: cannot filter inventory_items by cost_cents`,
      denied(await c.from("inventory_items").select("id").gt("cost_cents", 0).limit(1)),
    );
    check(
      `${label}: cannot order inventory_items by cost_cents`,
      denied(await c.from("inventory_items").select("id").order("cost_cents").limit(1)),
    );
    check(
      `${label}: cannot select inventory_movements.unit_cost_cents directly`,
      denied(
        await c.from("inventory_movements").select("id,unit_cost_cents").eq("org_id", ORG).limit(1),
      ),
    );
    check(
      `${label}: cannot filter inventory_movements by unit_cost_cents`,
      denied(await c.from("inventory_movements").select("id").gt("unit_cost_cents", 0).limit(1)),
    );
    // Through the gated functions.
    const items = await c.rpc("inventory_item_costs", { _org_id: ORG });
    const moves = await c.rpc("inventory_movement_costs", {
      _org_id: ORG,
      _movement_ids: moveIds.map((m) => m.id),
    });
    if (costs === null) {
      expectDeny(
        `${label}: inventory_item_costs refused without inventory.costs`,
        items.error ? { error: items.error.message } : { data: items.data },
      );
      expectDeny(
        `${label}: inventory_movement_costs refused without inventory.costs`,
        moves.error ? { error: moves.error.message } : { data: moves.data },
      );
    } else {
      const rows = items.data ?? [];
      const stores = new Set(rows.map((r) => itemLoc.get(r.item_id)));
      const expected = costs === "all" ? [L.downtown, L.riverside] : costs;
      check(
        `${label}: inventory_item_costs returns costs for its stores`,
        !items.error && expected.every((l) => stores.has(l)),
        items.error?.message ?? `stores ${[...stores].join(",")}`,
      );
      check(
        `${label}: inventory_item_costs returns no other store`,
        [...stores].every((l) => expected.includes(l)),
        [...stores].join(","),
      );
      check(
        `${label}: inventory_item_costs values match the stored costs`,
        rows.length > 0 && rows.every((r) => realCost.get(r.item_id) === r.cost_cents),
      );
      const mrows = moves.data ?? [];
      check(
        `${label}: inventory_movement_costs only for its stores`,
        !moves.error &&
          mrows.length > 0 &&
          mrows.every((r) => expected.includes(moveLoc.get(r.movement_id))),
        moves.error?.message ?? `${mrows.length} rows`,
      );
    }
    expectDeny(
      `${label}: inventory_item_costs refused for another organization`,
      await call(c, "inventory_item_costs", { _org_id: alpha.id }),
      "forbidden",
    );
  }
  // Anonymous callers: no execute grant and no table access.
  {
    const anon = createClient(URL_, process.env.SB_ANON, opts);
    const r = await anon.rpc("inventory_item_costs", { _org_id: ORG });
    check("anonymous: inventory_item_costs not executable", Boolean(r.error), "allowed");
    check(
      "anonymous: cannot read inventory_items",
      Boolean((await anon.from("inventory_items").select("id").limit(1)).error),
    );
  }
  // Writes: editing an item without inventory.costs keeps its stored cost; with it, the cost changes.
  {
    const stockUser = creds.roles[EMAIL.stock].userId;
    const { data: stockMember } = await svc
      .from("organization_members")
      .select("id,revoked_permissions")
      .eq("org_id", ORG)
      .eq("user_id", stockUser)
      .single();
    const { data: row } = await svc
      .from("inventory_items")
      .select("*")
      .eq("id", dtSoda.id)
      .single();
    const payload = (cost) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      sku: row.sku,
      unit: row.unit,
      quantity: row.quantity,
      minQuantity: row.min_quantity,
      costCents: cost,
      supplier: row.supplier,
      active: row.active,
    });
    const costNow = async () =>
      (await svc.from("inventory_items").select("cost_cents").eq("id", row.id).single()).data
        .cost_cents;
    const stock = await as(EMAIL.stock);
    try {
      // Test fixture: temporarily revoke inventory.costs from the stock keeper (restored below).
      await svc
        .from("organization_members")
        .update({
          revoked_permissions: [...(stockMember.revoked_permissions ?? []), "inventory.costs"],
        })
        .eq("id", stockMember.id);
      check(
        "stock without inventory.costs: cost function refused",
        (await call(stock, "inventory_item_costs", { _org_id: ORG })).error === "permission_denied",
      );
      const r = await call(stock, "save_operational_record", {
        _org_id: ORG,
        _location_id: L.downtown,
        _kind: "inventory",
        _payload: payload(row.cost_cents + 777),
      });
      check(
        "stock without inventory.costs: item edit allowed but cost unchanged",
        !r.error && (await costNow()) === row.cost_cents,
        r.error ?? `cost now ${await costNow()}`,
      );
    } finally {
      await svc
        .from("organization_members")
        .update({ revoked_permissions: stockMember.revoked_permissions ?? [] })
        .eq("id", stockMember.id);
    }
    const up = await call(stock, "save_operational_record", {
      _org_id: ORG,
      _location_id: L.downtown,
      _kind: "inventory",
      _payload: payload(row.cost_cents + 1),
    });
    check(
      "stock with inventory.costs: cost edit applied",
      !up.error && (await costNow()) === row.cost_cents + 1,
      up.error ?? "",
    );
    await call(stock, "save_operational_record", {
      _org_id: ORG,
      _location_id: L.downtown,
      _kind: "inventory",
      _payload: payload(row.cost_cents),
    });
    check("stock: original cost restored", (await costNow()) === row.cost_cents);
  }
  // Templates: who gets inventory.costs by default.
  {
    const { data: tpl } = await svc
      .from("permission_profiles")
      .select("key,permissions")
      .eq("is_system", true);
    const has = Object.fromEntries(
      tpl.map((p) => [p.key, p.permissions.includes("inventory.costs")]),
    );
    check(
      "templates: admin, manager, stock and finance include inventory.costs; cashier and kitchen do not",
      has.org_admin && has.manager && has.stock && has.finance && !has.cashier && !has.kitchen,
      JSON.stringify(has),
    );
  }
}
// ---------------- Cross-organization isolation (every tenant account vs. the other organization)
{
  const { data: alphaMember } = await svc
    .from("organization_members")
    .select("id")
    .eq("org_id", alpha.id)
    .limit(1)
    .single();
  const accounts = [
    ["manager", creds.team.manager.email, creds.team.manager.password],
    ...Object.entries(creds.roles).map(([e, v]) => [e.split("@")[0], e, v.password]),
  ];
  for (const [label, email, password] of accounts) {
    const c = await signedIn(email, password);
    let leaked = 0;
    for (const t of [
      "orders",
      "inventory_items",
      "finance_entries",
      "finance_expenses",
      "purchase_orders",
      "suppliers",
      "organization_members",
      "audit_logs",
      "invitations",
      "locations",
    ]) {
      leaked += await count(c, t, { org_id: alpha.id });
    }
    check(`${label}: reads nothing from another organization`, leaked === 0, `${leaked} rows`);
    check(
      `${label}: has no permissions in another organization`,
      ((await c.rpc("my_permissions", { _org_id: alpha.id })).data ?? []).length === 0,
    );
    expectDeny(
      `${label}: cannot change a member of another organization`,
      await call(c, "set_member_access", {
        _member_id: alphaMember.id,
        _role: "staff",
        _profile_id: null,
        _extra: [],
        _revoked: [],
        _location_ids: [],
      }),
      "forbidden",
    );
    expectDeny(
      `${label}: cannot create profiles in another organization`,
      await call(c, "save_permission_profile", {
        _org_id: alpha.id,
        _id: null,
        _name: "X",
        _description: "",
        _tier: "staff",
        _permissions: [],
      }),
      "forbidden",
    );
  }
}
// ---------------- Platform admin: no tenant data
{
  const c = await signedIn(creds.admin.email, creds.admin.password);
  check("platform admin reads no tenant orders", (await count(c, "orders", { org_id: ORG })) === 0);
  check(
    "platform admin has no tenant permissions",
    ((await c.rpc("my_permissions", { _org_id: ORG })).data ?? []).length === 0,
  );
}

// Cleanup: cancel every unpaid "Kitchen test" ticket this suite created (no payment, so no ledger or
// stock effect); keeps the demo KDS free of test tickets across runs.
{
  const { data: leftovers } = await svc
    .from("orders")
    .select("id")
    .eq("org_id", ORG)
    .eq("customer_name", "Kitchen test")
    .neq("status", "cancelled");
  for (const o of leftovers ?? []) {
    const { data: paid } = await svc.from("payments").select("id").eq("order_id", o.id).limit(1);
    if (!paid?.length)
      await mgr.rpc("cancel_order_with_reversal", {
        _order_id: o.id,
        _reason: "Permission test cleanup",
      });
  }
}
{
  // Cashier test sales are real paid orders at Downtown; only someone with orders.refund there (the
  // owner) can reverse them, so the suite reports them instead of leaving them silently.
  const { count: leftover } = await svc
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ORG)
    .eq("customer_name", "Permission test")
    .neq("status", "cancelled");
  // The owner (session from ownerSession) reverses them through the audited cancellation RPC.
  const owner = leftover ? await ownerSession() : null;
  const { data: open } = leftover
    ? await svc
        .from("orders")
        .select("id")
        .eq("org_id", ORG)
        .eq("customer_name", "Permission test")
        .neq("status", "cancelled")
    : { data: [] };
  let reversed = 0;
  for (const o of open ?? []) {
    const r = await owner.rpc("cancel_order_with_reversal", {
      _order_id: o.id,
      _reason: "Permission test cleanup",
    });
    if (!r.error) reversed++;
  }
  if (leftover > reversed)
    console.log(
      `NOTE: ${leftover - reversed} paid test sales could not be reversed at Downtown (customer "Permission test").`,
    );
}
// Cleanup: archive the test expenses created by the finance checks (Riverside), using the store
// manager, who holds expenses.delete there. Archived = active:false (same path as the UI's delete).
{
  const { data: testExpenses } = await svc
    .from("finance_expenses")
    .select("id,location_id,payload")
    .eq("org_id", ORG)
    .eq("active", true)
    .filter("payload->>description", "eq", "Fiber internet (permission test)");
  for (const e of testExpenses ?? []) {
    await mgr.rpc("save_operational_record", {
      _org_id: ORG,
      _location_id: e.location_id,
      _kind: "expense",
      _payload: { ...e.payload, id: e.id, active: false },
    });
  }
}
const failed = results.filter((r) => !r.ok);
for (const r of results)
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "  → " + r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
