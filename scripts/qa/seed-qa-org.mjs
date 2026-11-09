// Seeds the isolated QA tenant used by the security/permission regression suites.
//
// This is NOT the commercial demo (MARAO / Aurora). It runs only against the disposable QA stack
// (local `dq-rebuild` on port 55321, or the ephemeral Supabase started inside CI) and refuses the
// demo stack (54321) and any hosted URL.
//
// Usage (repo root):
//   SB_URL=http://127.0.0.1:55321 SB_ANON=<qa anon key> SB_SERVICE=<qa service key> \
//   CREDS_FILE=<path outside the repo> node scripts/qa/seed-qa-org.mjs
//
// Everything is created through the same RPCs the UI calls (create_organization, create_location,
// save_operational_menu/record, persist_finalized_pos_sale_atomic, create_invitation /
// accept_invitation ...). Accounts are created confirmed with the service role (the QA stack has
// no mail server). Generated passwords are written only to CREDS_FILE and never printed.
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const URL_ = process.env.SB_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(URL_))
  throw new Error("Refusing: SB_URL must be the disposable QA stack (http://127.0.0.1:55321)");
const ANON = process.env.SB_ANON;
const SERVICE = process.env.SB_SERVICE;
const CREDS_FILE = process.env.CREDS_FILE;
if (!ANON || !SERVICE || !CREDS_FILE)
  throw new Error("SB_ANON, SB_SERVICE and CREDS_FILE are required");

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(URL_, SERVICE, opts);
const password = () => crypto.randomBytes(18).toString("base64url") + "!a9";
const DOMAIN = "qa.dinequora.test";
const NIL = "00000000-0000-0000-0000-000000000000";

if (fs.existsSync(CREDS_FILE) && JSON.parse(fs.readFileSync(CREDS_FILE, "utf8")).seededAt) {
  console.log("QA tenant already seeded (CREDS_FILE has seededAt); nothing to do.");
  process.exit(0);
}

async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error)
    throw new Error(`${fn}: ${error.message}${error.details ? ` (${error.details})` : ""}`);
  return data;
}
async function signedIn(email, pw) {
  const c = createClient(URL_, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return c;
}
async function account(email, fullName, lang = "en-US") {
  const pw = password();
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
    user_metadata: { full_name: fullName, preferred_language: lang },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return { email, userId: data.user.id, password: pw };
}

const log = [];
const creds = { kind: "dinequora-qa", url: URL_, emails: {}, roles: {}, team: {} };
const save = () => fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });

// 1. Accounts ------------------------------------------------------------------------------
creds.owner = await account(`owner@${DOMAIN}`, "QA Owner");
creds.admin = await account(`platform.admin@${DOMAIN}`, "QA Platform Admin");
const tenantB = await account(`owner.tenant-b@${DOMAIN}`, "QA Tenant B Owner");
creds.tenantB = { owner: tenantB };
save();
const { data: admins } = await svc
  .from("user_roles")
  .select("user_id")
  .eq("role", "platform_admin");
if (!admins?.length) {
  await rpc(svc, "bootstrap_first_platform_admin", {
    _user_id: creds.admin.userId,
    _authorization_note: "Disposable QA stack bootstrap (never hosted)",
  });
  log.push("platform admin bootstrapped");
} else log.push("platform admin already present (bootstrap skipped)");
const owner = await signedIn(creds.owner.email, creds.owner.password);
const admin = await signedIn(creds.admin.email, creds.admin.password);

// 2. QA organization with two stores -----------------------------------------------------
creds.orgId = await rpc(owner, "create_organization", {
  _name: "Dinequora QA (isolated)",
  _brand_primary: "#334155",
  _location_name: "QA Downtown",
});
await rpc(admin, "admin_set_subscription", {
  _org_id: creds.orgId,
  _plan: "growth",
  _status: "active",
  _reason: "QA tenant: two stores for permission/store-scope regression",
});
const riversideId = await rpc(owner, "create_location", {
  _org_id: creds.orgId,
  _name: "QA Riverside",
  _address: "QA fixture address",
  _timezone: "America/New_York",
  _phone: "+1 555-0100",
});
const { data: locs } = await owner.from("locations").select("id,name").eq("org_id", creds.orgId);
creds.locations = {
  downtown: locs.find((l) => l.name === "QA Downtown").id,
  riverside: riversideId,
};
const { data: org } = await owner
  .from("organizations")
  .select("slug")
  .eq("id", creds.orgId)
  .single();
save();
log.push(`org ${org.slug} with stores QA Downtown / QA Riverside`);

// 3. Menu, stock, recipe ------------------------------------------------------------------
const BOTH = [creds.locations.downtown, creds.locations.riverside];
await rpc(owner, "save_operational_menu", {
  _org_id: creds.orgId,
  _kind: "category",
  _payload: { id: "cat-drinks", name: "Drinks" },
});
await rpc(owner, "save_operational_menu", {
  _org_id: creds.orgId,
  _kind: "product",
  _payload: {
    id: "prod-soda",
    orgId: org.slug,
    name: "QA Soda",
    description: "QA fixture",
    category: "cat-drinks",
    priceCents: 275,
    prepTimeMinutes: 1,
    imageUrl: "",
    notes: "",
    active: true,
    locationIds: BOTH,
    modifierGroups: [],
    createdAt: new Date().toISOString(),
  },
});
creds.fixtures = { sodaSku: "QA-SODA", productId: "prod-soda", otherOrgSlug: null };
const inv = {};
for (const [store, loc] of Object.entries(creds.locations)) {
  inv[store] = await rpc(owner, "save_operational_record", {
    _org_id: creds.orgId,
    _location_id: loc,
    _kind: "inventory",
    _payload: {
      name: "QA Soda can",
      category: "beverages",
      sku: "QA-SODA",
      unit: "units",
      quantity: 200,
      minQuantity: 10,
      costCents: 60,
      supplier: "QA Supplier",
      active: true,
    },
  });
  await rpc(owner, "save_operational_record", {
    _org_id: creds.orgId,
    _location_id: loc,
    _kind: "recipe",
    _payload: {
      productId: "prod-soda",
      servings: 1,
      yieldQuantity: 1,
      ingredients: [
        { inventoryItemId: inv[store], quantity: 1, unit: "units", wastePercentage: 0 },
      ],
    },
  });
}
const supplierId = await rpc(owner, "save_operational_record", {
  _org_id: creds.orgId,
  _location_id: NIL,
  _kind: "supplier",
  _payload: { name: "QA Supplier", notes: "QA fixture", active: true },
});
await rpc(owner, "save_operational_record", {
  _org_id: creds.orgId,
  _location_id: creds.locations.downtown,
  _kind: "purchase",
  _payload: {
    supplierId,
    status: "sent",
    discountCents: 0,
    taxCents: 0,
    shippingCents: 0,
    notes: "QA open PO",
    items: [{ inventoryItemId: inv.downtown, quantityOrdered: 48, unitPriceCents: 60 }],
  },
});
log.push("menu (prod-soda), stock QA-SODA x2 stores, recipes, supplier, open PO at Downtown");

// 4. Sales: delivered tickets at both stores (finance entries, KDS history, audit) -----------
for (const [store, loc] of Object.entries(creds.locations)) {
  for (let i = 0; i < 3; i++) {
    const id = await rpc(owner, "persist_finalized_pos_sale_atomic", {
      _org_id: creds.orgId,
      _location_id: loc,
      _type: "takeout",
      _customer_name: `QA ${store} ${i}`,
      _items: [{ product_id: "prod-soda", quantity: 2, modifiers: [] }],
      _tax_rate_basis_points: 625,
      _client_order_id: `qa-seed-${store}-${i}`,
      _payment_method: "cash",
    });
    for (const s of ["in_prep", "ready", "delivered"])
      await rpc(owner, "update_order_status", {
        _order_id: id,
        _new_status: s,
        _reason: "QA seed",
      });
  }
}
log.push("6 delivered sales (3 per store)");

// 5. Team: one account per system profile, invited and accepted through the real flow ---------
const { data: profiles } = await owner
  .from("permission_profiles")
  .select("id,key")
  .eq("is_system", true);
const P = Object.fromEntries(profiles.map((p) => [p.key, p.id]));
const TEAM = [
  ["manager", `manager.riverside@${DOMAIN}`, "manager", "manager", [creds.locations.riverside]],
  ["cashier", `cashier.downtown@${DOMAIN}`, "staff", "cashier", [creds.locations.downtown]],
  ["kitchen", `kitchen.riverside@${DOMAIN}`, "staff", "kitchen", [creds.locations.riverside]],
  ["stock", `stock.downtown@${DOMAIN}`, "staff", "stock", [creds.locations.downtown]],
  ["finance", `finance@${DOMAIN}`, "staff", "finance", BOTH],
];
for (const [label, email, role, profile, locations] of TEAM) {
  const token = await rpc(owner, "create_invitation", {
    _org_id: creds.orgId,
    _email: email,
    _role: role,
    _location_ids: locations,
    _profile_id: role === "manager" ? null : P[profile],
  });
  const acc = await account(email, `QA ${label}`, label === "kitchen" ? "pt-BR" : "en-US");
  await rpc(await signedIn(email, acc.password), "accept_invitation", { _token: token });
  creds.emails[label] = email;
  if (label === "manager") creds.team.manager = acc;
  else creds.roles[email] = { userId: acc.userId, password: acc.password };
  save();
}
log.push(`team: ${TEAM.map((t) => t[0]).join(", ")} (invited + accepted)`);

// 6. Second tenant (cross-organization isolation target) with its own rows ------------------
const b = await signedIn(tenantB.email, tenantB.password);
const bOrg = await rpc(b, "create_organization", {
  _name: "QA Tenant B",
  _brand_primary: "#7c2d12",
  _location_name: "Tenant B Store",
});
await rpc(admin, "admin_set_subscription", {
  _org_id: bOrg,
  _plan: "starter",
  _status: "active",
  _reason: "QA tenant B",
});
const { data: bLoc } = await b.from("locations").select("id").eq("org_id", bOrg).single();
const { data: bRow } = await b.from("organizations").select("slug").eq("id", bOrg).single();
await rpc(b, "save_operational_menu", {
  _org_id: bOrg,
  _kind: "category",
  _payload: { id: "cat-b", name: "B" },
});
await rpc(b, "save_operational_menu", {
  _org_id: bOrg,
  _kind: "product",
  _payload: {
    id: "prod-b",
    orgId: bRow.slug,
    name: "Tenant B item",
    description: "",
    category: "cat-b",
    priceCents: 500,
    prepTimeMinutes: 1,
    imageUrl: "",
    notes: "",
    active: true,
    locationIds: [bLoc.id],
    modifierGroups: [],
    createdAt: new Date().toISOString(),
  },
});
await rpc(b, "save_operational_record", {
  _org_id: bOrg,
  _location_id: bLoc.id,
  _kind: "inventory",
  _payload: {
    name: "Tenant B secret-cost item",
    category: "dry_goods",
    sku: "B-1",
    unit: "units",
    quantity: 5,
    minQuantity: 1,
    costCents: 999,
    supplier: "",
    active: true,
  },
});
await rpc(b, "persist_finalized_pos_sale_atomic", {
  _org_id: bOrg,
  _location_id: bLoc.id,
  _type: "takeout",
  _customer_name: "Tenant B",
  _items: [{ product_id: "prod-b", quantity: 1, modifiers: [] }],
  _client_order_id: "qa-b-1",
  _payment_method: "cash",
});
creds.tenantB.orgId = bOrg;
creds.fixtures.otherOrgSlug = bRow.slug;
creds.seededAt = new Date().toISOString();
save();
log.push(`tenant B ${bRow.slug} with menu, stock (cost 999) and one sale`);

console.log(log.map((l) => "  - " + l).join("\n"));
console.log(`QA tenant seeded. Credentials written to CREDS_FILE (passwords not printed).`);
