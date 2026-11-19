// POS sale flow integrity (migrations 0025, 0032, 0033, 0036). LOCAL/CI QA stack ONLY.
//
// Real PostgreSQL sessions impersonate each caller (request.jwt.claim.sub + role authenticated, anon or
// service_role) and call the sale RPCs directly, as a crafted API request would, to prove that:
//   normal      a sale (persist_finalized_pos_sale_atomic_v2) records order, payment, ledger entries and
//               audit; an open order (create_pos_sale_v2) records the order only;
//   lost reply  the same key and payload again returns the SAME order and writes nothing; the register's
//               lookup by key finds it through RLS; the same key with another payload is refused;
//   closed key  a key closed by resolve_pending_pos_sale is refused by EVERY v2 entry point; a key that
//               has an order is never closed;
//   concurrent  two sessions with the same key, COMMIT and ROLLBACK: the second waits for the key's
//               lock and gets the same order (or records its own after the rollback); ten simultaneous
//               sends: exactly one order, one payment, one set of ledger entries;
//   legacy      the three basis-point RPCs retired by 0036 are refused (permission denied) for every
//               API role and write nothing; called by the owner of the functions they still delegate
//               to v2, so even there a closed key is refused and a replay is the same order: they
//               were never, and are not, a way around the idempotency;
//   roles       who may sell where: owner (every store), organization admin, manager and cashier (their
//               stores); kitchen staff, other tenants, platform admins and anon never;
//   isolation   another tenant reads nothing of the sale; nobody writes orders, payments or the ledger
//               directly; the audit rows carry actor and store.
// Isolation: two own organizations, synthetic users and one platform-role row, all removed at the end.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/pos_sale_flow_integrity.mjs
import crypto from "node:crypto";
import { createRequire } from "node:module";
import {
  countOrgRowsSql,
  createIsolatedOrgSql,
  createTestUsersSql,
  dropIsolatedOrgsSql,
  dropTestUsersSql,
  isolatedOrg,
} from "../qa/isolated-org.mjs";
import { assertDisposableDb, exitOnRefusal } from "../guard/target-guard.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const postgres = require("postgres");

const DB_URL = process.env.QA_DB_URL ?? process.env.DB_URL;
await assertDisposableDb(DB_URL, "test:pos-sale-flow").catch(exitOnRefusal);

const RATE = 82500; // 8.25% in parts per million = 825 basis points for the legacy signatures
const BP = RATE / 100;
const ROLES = ["OWNER", "ADMIN", "MGR", "CASHIER", "KITCHEN", "OWNERB", "PLAT"];
const U = Object.fromEntries(ROLES.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("saleflow", {
  taxRatePpm: RATE,
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.ADMIN, role: "manager", store: true },
    { userId: U.MGR, role: "manager", store: true },
    { userId: U.CASHIER, role: "staff", store: true },
    { userId: U.KITCHEN, role: "staff", store: true },
  ],
});
const B = isolatedOrg("saleflowb", {
  taxRatePpm: RATE,
  members: [{ userId: U.OWNERB, role: "owner" }],
});
const ORG = A.orgId;
const S1 = A.locationId;
const S2 = crypto.randomUUID();
const PRODUCT = `sf-soda-${A.key}`;
const ITEMS = [{ product_id: PRODUCT, quantity: 1, modifiers: [] }];
const mid = (uid) => A.members.find((m) => m.userId === uid).memberId;
const key = (n) => `${A.key}-${n}`;

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (e) => String(e?.message ?? e).split("\n")[0];

/** A dedicated connection: `who` is a user key, "ANON" (role anon), "SERVICE" (role service_role), or
 *  "DBOWNER:<user key>" (the owner of the functions, with that user's claims). */
async function session(who) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  const [kind, as] = who.startsWith("DBOWNER:") ? ["owner", who.slice(8)] : [who, who];
  const uid = U[as];
  if (uid) {
    await c`select set_config('request.jwt.claim.sub', ${uid}, false)`;
    await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, false)`;
  }
  await c`set lock_timeout = '20s'`;
  if (kind === "ANON") await c`set role anon`;
  else if (kind === "SERVICE") await c`set role service_role`;
  else if (kind !== "owner") await c`set role authenticated`;
  const [{ pid }] = await c`select pg_backend_pid() as pid`;
  return { c, pid, end: () => c.end({ timeout: 5 }) };
}
async function as(who, fn) {
  const s = await session(who);
  try {
    return await fn(s);
  } catch (e) {
    return code(e);
  } finally {
    await s.end();
  }
}
// current flow (v2, parts per million)
const persistV2 = (s, k, { store = S1, items = ITEMS, org = ORG } = {}) =>
  s.c`select public.persist_finalized_pos_sale_atomic_v2(${org}, ${store}, 'takeout', 'Flow test',
        _tax_rate_ppm => ${RATE}, _items => ${s.c.json(items)}, _client_order_id => ${k}, _payment_method => 'cash') as id`.then(
    (r) => r[0].id,
  );
const finalizeV2 = (s, k) =>
  s.c`select public.finalize_pos_sale_atomic_v2(${ORG}, ${S1}, 'takeout', 'Flow test',
        _tax_rate_ppm => ${RATE}, _items => ${s.c.json(ITEMS)}, _client_order_id => ${k}, _payment_method => 'cash') as id`.then(
    (r) => r[0].id,
  );
const createV2 = (s, k) =>
  s.c`select public.create_pos_sale_v2(${ORG}, ${S1}, 'takeout', 'Flow test',
        _tax_rate_ppm => ${RATE}, _items => ${s.c.json(ITEMS)}, _client_order_id => ${k}) as id`.then(
    (r) => r[0].id,
  );
// retired signatures (basis points)
const LEGACY = {
  create_pos_sale: (s, k) =>
    s.c`select public.create_pos_sale(${ORG}, ${S1}, 'takeout', 'Flow test',
          _tax_rate_basis_points => ${BP}, _items => ${s.c.json(ITEMS)}, _client_order_id => ${k}) as id`.then(
      (r) => r[0].id,
    ),
  finalize_pos_sale_atomic: (s, k) =>
    s.c`select public.finalize_pos_sale_atomic(${ORG}, ${S1}, 'takeout', 'Flow test',
          _tax_rate_basis_points => ${BP}, _items => ${s.c.json(ITEMS)}, _client_order_id => ${k}, _payment_method => 'cash') as id`.then(
      (r) => r[0].id,
    ),
  persist_finalized_pos_sale_atomic: (s, k) =>
    s.c`select public.persist_finalized_pos_sale_atomic(${ORG}, ${S1}, 'takeout', 'Flow test',
          _tax_rate_basis_points => ${BP}, _items => ${s.c.json(ITEMS)}, _client_order_id => ${k}, _payment_method => 'cash') as id`.then(
      (r) => r[0].id,
    ),
};
const resolve = (s, k) =>
  s.c`select public.resolve_pending_pos_sale(${ORG}, ${S1}, ${k}, 'Flow test: the customer left without paying') as r`.then(
    (r) => r[0].r.status,
  );
/** What one key left in the database (as the database owner). */
const state = async (k) =>
  (
    await sql`select
      (select count(*)::int from public.orders o where o.org_id = ${ORG} and o.client_order_id = ${k}) as orders,
      (select count(*)::int from public.payments p join public.orders o on o.id = p.order_id where o.org_id = ${ORG} and o.client_order_id = ${k}) as payments,
      (select count(*)::int from public.finance_entries f join public.orders o on o.id = f.order_id where o.org_id = ${ORG} and o.client_order_id = ${k}) as ledger,
      (select count(*)::int from public.pos_sale_key_voids v where v.org_id = ${ORG} and v.client_order_id = ${k}) as closed`
  )[0];
const totals = async () =>
  JSON.stringify(
    (
      await sql`select (select count(*)::int from public.orders where org_id = ${ORG}) o,
                     (select count(*)::int from public.payments where org_id = ${ORG}) p,
                     (select count(*)::int from public.finance_entries where org_id = ${ORG}) f,
                     (select count(*)::int from public.audit_logs where org_id = ${ORG}) a`
    )[0],
  );
async function blockedBy(pid, byPid) {
  for (let i = 0; i < 100; i++) {
    const [row] =
      await sql`select wait_event_type as w, ${byPid}::int = any(pg_blocking_pids(${pid})) as by
                  from pg_stat_activity where pid = ${pid}`;
    if (row?.w === "Lock" && row.by) return true;
    await sleep(100);
  }
  return false;
}
const uuidLike = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

try {
  // ---------------------------------------------------------------- fixture
  await sql.unsafe(
    createTestUsersSql(
      ROLES.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql.unsafe(`begin;
    insert into public.locations(id, org_id, slug, name, address, tax_rate_ppm)
      values ('${S2}', '${ORG}', 't_${A.key}_s2', 'Second ${A.key}', '2 Test Street', ${RATE});
    insert into public.user_roles(user_id, role) values ('${U.PLAT}', 'platform_admin');
    commit;`);
  const profile = async (k) =>
    (await sql`select id from public.permission_profiles where is_system and key = ${k}`)[0].id;
  const [ORG_ADMIN, CASHIER, KITCHEN] = [
    await profile("org_admin"),
    await profile("cashier"),
    await profile("kitchen"),
  ];
  {
    const s = await session("OWNER");
    const access = (memberId, role, prof) =>
      s.c`select public.set_member_access(${memberId}, ${role}::public.org_role, ${prof}::uuid, '{}'::text[], '{}'::text[], ${[S1]}::uuid[])`;
    await access(mid(U.ADMIN), "manager", ORG_ADMIN);
    await access(mid(U.CASHIER), "staff", CASHIER);
    await access(mid(U.KITCHEN), "staff", KITCHEN);
    await s.c`select public.save_operational_menu(${ORG}, 'category', ${s.c.json({ op: "create", id: `sf-drinks-${A.key}`, name: "Drinks" })})`;
    await s.c`select public.save_operational_menu(${ORG}, 'product', ${s.c.json({ id: PRODUCT, name: "Flow soda", category: `sf-drinks-${A.key}`, priceCents: 400, prepTimeMinutes: 1, locationIds: [], modifierGroups: [] })})`;
    await s.end();
  }
  check(
    "fixture: 2 stores, owner, org admin, manager, cashier, kitchen staff, other tenant, platform admin",
    true,
  );

  // ---------------------------------------------------------------- normal sale and open order
  const kSale = key("sale");
  const saleId = await as("CASHIER", (s) => persistV2(s, kSale));
  {
    const st = await state(kSale);
    const [o] =
      await sql`select status::text, subtotal_cents, tax_cents, total_cents, tax_rate_ppm, location_id::text loc, created_by::text by
                  from public.orders where id = ${uuidLike(saleId) ? saleId : null}`;
    check(
      "N1 a sale by the cashier records one order, one payment and the ledger entries, at the store's rate",
      uuidLike(saleId) &&
        st.orders === 1 &&
        st.payments === 1 &&
        st.ledger === 2 && // a product without a recipe: revenue and tax, no cost of goods
        o?.subtotal_cents === 400 &&
        o.tax_cents === 33 &&
        o.total_cents === 433 &&
        o.tax_rate_ppm === RATE &&
        o.loc === S1 &&
        o.by === U.CASHIER,
      `${String(saleId).slice(0, 40)} ${JSON.stringify(st)} ${JSON.stringify(o ?? {})}`,
    );
    const a =
      await sql`select action, actor_id::text actor, location_id::text loc from public.audit_logs
                         where org_id = ${ORG} and (target = ${String(saleId)} or metadata->>'client_order_id' = ${kSale}) order by created_at, id`;
    check(
      "N2 the sale is audited with actor and store (orders.created and pos.finalized)",
      a.some((x) => x.action === "orders.created") &&
        a.some((x) => x.action === "pos.finalized") &&
        a.every((x) => x.actor === U.CASHIER && x.loc === S1),
      JSON.stringify(a.map((x) => x.action)),
    );
  }
  {
    const kOpen = key("open");
    const id = await as("CASHIER", (s) => createV2(s, kOpen));
    const st = await state(kOpen);
    check(
      "N3 an open order (create_pos_sale_v2) records the order only: no payment",
      uuidLike(id) && st.orders === 1 && st.payments === 0,
      `${String(id).slice(0, 40)} ${JSON.stringify(st)}`,
    );
  }

  // ---------------------------------------------------------------- lost reply
  {
    const before = await totals();
    const again = await as("CASHIER", (s) => persistV2(s, kSale));
    check(
      "R1 the same key and payload again returns the same order and writes nothing",
      again === saleId && (await totals()) === before,
      String(again).slice(0, 60),
    );
    const found = await as("CASHIER", (s) =>
      s.c`select id::text from public.orders where org_id = ${ORG} and client_order_id = ${kSale}`.then(
        (r) => r[0]?.id,
      ),
    );
    check(
      "R2 the register's lookup by key finds the recorded sale through RLS",
      found === saleId,
      String(found),
    );
    const other = await as("CASHIER", (s) =>
      persistV2(s, kSale, { items: [{ product_id: PRODUCT, quantity: 2, modifiers: [] }] }),
    );
    check(
      "R3 the same key with another payload is refused (idempotency_conflict), nothing written",
      other === "idempotency_conflict" && (await totals()) === before,
      String(other),
    );
    const byOther = await as("MGR", (s) => persistV2(s, kSale));
    check(
      "R4 a replay by another member returns the same order too (the key belongs to the organization)",
      byOther === saleId && (await totals()) === before,
      String(byOther).slice(0, 60),
    );
  }

  // ---------------------------------------------------------------- closed key
  const kClosed = key("closed");
  {
    const r = await as("OWNER", (s) => resolve(s, kClosed));
    const before = await totals();
    const tries = {
      persist_v2: await as("CASHIER", (s) => persistV2(s, kClosed)),
      finalize_v2: await as("CASHIER", (s) => finalizeV2(s, kClosed)),
      create_v2: await as("CASHIER", (s) => createV2(s, kClosed)),
      owner_persist_v2: await as("OWNER", (s) => persistV2(s, kClosed)),
    };
    const st = await state(kClosed);
    check(
      "K1 a closed key is refused by every v2 entry point, for the cashier and the owner (sale_key_voided); nothing recorded",
      r === "resolved" &&
        Object.values(tries).every((v) => v === "sale_key_voided") &&
        st.orders === 0 &&
        st.closed === 1 &&
        (await totals()) === before,
      `${r} ${JSON.stringify(tries)}`,
    );
    const r2 = await as("OWNER", (s) => resolve(s, kSale));
    const st2 = await state(kSale);
    check(
      "K2 a key that has an order is never closed (recorded): the sale stays",
      r2 === "recorded" && st2.closed === 0 && st2.orders === 1,
      r2,
    );
  }

  // ---------------------------------------------------------------- concurrency (real sessions)
  for (const [end, label] of [
    ["commit", "COMMIT"],
    ["rollback", "ROLLBACK"],
  ]) {
    const k = key(`race-${end}`);
    const a = await session("CASHIER");
    const b = await session("MGR");
    let idA, idB, waited;
    try {
      await a.c`begin`;
      idA = await persistV2(a, k).catch(code);
      await b.c`begin`;
      const attempt = persistV2(b, k).catch(code);
      waited = await blockedBy(b.pid, a.pid);
      await a.c.unsafe(end);
      idB = await attempt;
      await b.c`commit`;
    } finally {
      // never leave a session holding the key's lock (the cleanup would wait for it)
      await a.end();
      await b.end();
    }
    const st = await state(k);
    if (end === "commit")
      check(
        `C1 ${label}: the second send waits for the key's lock and gets the same order: one order, one payment`,
        waited && uuidLike(idA) && idB === idA && st.orders === 1 && st.payments === 1,
        `${waited} ${String(idB).slice(0, 40)} ${JSON.stringify(st)}`,
      );
    else
      check(
        `C1 ${label}: after the first rolls back, the second records its own sale: one order, one payment`,
        waited &&
          uuidLike(idA) &&
          uuidLike(idB) &&
          idB !== idA &&
          st.orders === 1 &&
          st.payments === 1,
        `${waited} ${JSON.stringify(st)}`,
      );
  }
  {
    const k = key("burst");
    const callers = [
      "CASHIER",
      "MGR",
      "OWNER",
      "ADMIN",
      "CASHIER",
      "MGR",
      "OWNER",
      "ADMIN",
      "CASHIER",
      "MGR",
    ];
    const sessions = await Promise.all(callers.map((w) => session(w)));
    let ids;
    try {
      ids = await Promise.all(sessions.map((s) => persistV2(s, k).catch(code)));
    } finally {
      await Promise.all(sessions.map((s) => s.end()));
    }
    const st = await state(k);
    const ledgerOfOne = (await state(kSale)).ledger;
    check(
      "C2 ten simultaneous sends of one sale: every caller gets the same order; exactly one order, one payment, one set of ledger entries",
      ids.every((v) => uuidLike(v) && v === ids[0]) &&
        st.orders === 1 &&
        st.payments === 1 &&
        st.ledger === ledgerOfOne,
      `${new Set(ids).size} distinct answers ${JSON.stringify(st)}`,
    );
  }

  // ---------------------------------------------------------------- legacy signatures (retired by 0036)
  for (const [name, call] of Object.entries(LEGACY)) {
    const before = await totals();
    const out = {};
    for (const who of ["OWNER", "ADMIN", "MGR", "CASHIER", "ANON", "SERVICE"])
      out[who] = await as(who, (s) => call(s, key(`legacy-${name}-${who}`)));
    check(
      `L1 ${name}: permission denied for every API role (members, anon, service_role); nothing written`,
      Object.values(out).every((v) => v === `permission denied for function ${name}`) &&
        (await totals()) === before,
      JSON.stringify(out),
    );
    const closed = await as("CASHIER", (s) => call(s, kClosed));
    check(
      `L2 ${name}: no way to a closed key for a member`,
      closed === `permission denied for function ${name}` && (await state(kClosed)).orders === 0,
      String(closed),
    );
  }
  {
    // the owner of the functions (not an API role) still reaches v2 through them: the same rules apply
    const out = {};
    for (const [name, call] of Object.entries(LEGACY))
      out[name] = await as("DBOWNER:CASHIER", (s) => call(s, kClosed));
    check(
      "L3 called by the owner of the functions, each retired signature delegates to v2: the closed key is refused (sale_key_voided)",
      Object.values(out).every((v) => v === "sale_key_voided") &&
        (await state(kClosed)).orders === 0,
      JSON.stringify(out),
    );
    const k = key("legacy-replay");
    const first = await as("DBOWNER:CASHIER", (s) =>
      LEGACY.persist_finalized_pos_sale_atomic(s, k),
    );
    const second = await as("CASHIER", (s) => persistV2(s, k));
    const st = await state(k);
    check(
      "L4 a sale recorded through a retired signature (by the owner) and replayed through v2 is ONE order: same idempotency",
      uuidLike(first) && second === first && st.orders === 1 && st.payments === 1,
      `${String(first).slice(0, 40)} / ${String(second).slice(0, 40)} ${JSON.stringify(st)}`,
    );
  }
  {
    const acl =
      await sql`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
        has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('service_role', p.oid, 'execute') as service,
        p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ','), '') as cfg, count(*) over (partition by p.proname)::int as defs
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('create_pos_sale','finalize_pos_sale_atomic','persist_finalized_pos_sale_atomic',
                           'create_pos_sale_v2','finalize_pos_sale_atomic_v2','persist_finalized_pos_sale_atomic_v2') order by 1`;
    const legacy = acl.filter((f) => !f.proname.endsWith("_v2"));
    const current = acl.filter((f) => f.proname.endsWith("_v2"));
    check(
      "L5 privileges: the three retired functions are executable by no API role; the three current ones by authenticated only (never anon); all SECURITY DEFINER with a fixed search_path, one definition each",
      legacy.length === 3 &&
        current.length === 3 &&
        legacy.every((f) => !f.auth && !f.anon && !f.service) &&
        current.every((f) => f.auth && !f.anon) &&
        acl.every((f) => f.definer && f.cfg.includes("search_path=") && f.defs === 1),
      JSON.stringify(
        acl.map(
          (f) =>
            `${f.proname}:${f.auth ? "auth" : ""}${f.anon ? "+anon" : ""}${f.service ? "+service" : ""}`,
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- who may sell where
  {
    const out = {
      owner_s1: await as("OWNER", (s) => persistV2(s, key("p-owner-s1"))),
      owner_s2: await as("OWNER", (s) => persistV2(s, key("p-owner-s2"), { store: S2 })),
      admin_s1: await as("ADMIN", (s) => persistV2(s, key("p-admin-s1"))),
      admin_s2: await as("ADMIN", (s) => persistV2(s, key("p-admin-s2"), { store: S2 })),
      manager_s1: await as("MGR", (s) => persistV2(s, key("p-mgr-s1"))),
      manager_s2: await as("MGR", (s) => persistV2(s, key("p-mgr-s2"), { store: S2 })),
      cashier_s1: await as("CASHIER", (s) => persistV2(s, key("p-cashier-s1"))),
      cashier_s2: await as("CASHIER", (s) => persistV2(s, key("p-cashier-s2"), { store: S2 })),
      kitchen_s1: await as("KITCHEN", (s) => persistV2(s, key("p-kitchen-s1"))),
      other_tenant: await as("OWNERB", (s) => persistV2(s, key("p-otherb"))),
      other_tenant_own_org_foreign_store: await as("OWNERB", (s) =>
        persistV2(s, key("p-otherb2"), { org: B.orgId }),
      ),
      platform_admin: await as("PLAT", (s) => persistV2(s, key("p-plat"))),
      anon: await as("ANON", (s) => persistV2(s, key("p-anon"))),
    };
    const ok = (v) => uuidLike(v);
    check(
      "P1 who may sell: owner at every store; organization admin, manager and cashier at their store only; kitchen staff, other tenant, platform admin and anon never",
      ok(out.owner_s1) &&
        ok(out.owner_s2) &&
        ok(out.admin_s1) &&
        ok(out.manager_s1) &&
        ok(out.cashier_s1) &&
        out.admin_s2 === "forbidden" &&
        out.manager_s2 === "forbidden" &&
        out.cashier_s2 === "forbidden" &&
        out.kitchen_s1 === "permission_denied" &&
        out.other_tenant === "forbidden" &&
        out.other_tenant_own_org_foreign_store === "forbidden" &&
        out.platform_admin === "forbidden" &&
        out.anon === "permission denied for function persist_finalized_pos_sale_atomic_v2",
      JSON.stringify(
        Object.fromEntries(Object.entries(out).map(([k, v]) => [k, ok(v) ? "sold" : v])),
      ),
    );
    const [n] =
      await sql`select count(*)::int n from public.orders where org_id = ${ORG} and client_order_id like ${A.key + "-p-%"}`;
    check("P2 exactly the five allowed sales were recorded", n.n === 5, String(n.n));
  }

  // ---------------------------------------------------------------- isolation, direct writes
  {
    const seen = await as("OWNERB", (s) =>
      s.c`select (select count(*)::int from public.orders where org_id = ${ORG}) o, (select count(*)::int from public.payments where org_id = ${ORG}) p,
                 (select count(*)::int from public.finance_entries where org_id = ${ORG}) f, (select count(*)::int from public.audit_logs where org_id = ${ORG}) a,
                 (select count(*)::int from public.pos_sale_key_voids where org_id = ${ORG}) v`.then(
        (r) => r[0],
      ),
    );
    check(
      "T1 another tenant reads no order, payment, ledger entry, audit row or closed key of the organization (RLS)",
      seen.o === 0 && seen.p === 0 && seen.f === 0 && seen.a === 0 && seen.v === 0,
      JSON.stringify(seen),
    );
    const before = await totals();
    const sqlstate = async (who, fn) => {
      const s = await session(who);
      try {
        const r = await fn(s);
        return `rows:${r.count}`;
      } catch (e) {
        return e?.code ?? code(e);
      } finally {
        await s.end();
      }
    };
    const w = {
      order: await sqlstate(
        "CASHIER",
        (s) =>
          s.c`insert into public.orders(org_id, location_id, order_number, type, client_order_id, request_hash, created_by) values (${ORG}, ${S1}, 'forged', 'takeout', ${key("forged")}, 'x', ${U.CASHIER})`,
      ),
      payment: await sqlstate(
        "OWNER",
        (s) =>
          s.c`insert into public.payments(org_id, location_id, order_id, method, amount_cents) values (${ORG}, ${S1}, ${saleId}, 'cash', 1)`,
      ),
      ledger: await sqlstate(
        "OWNER",
        (s) =>
          s.c`insert into public.finance_entries(org_id, location_id, kind, amount_cents) values (${ORG}, ${S1}, 'revenue', 1)`,
      ),
      audit: await sqlstate(
        "OWNER",
        (s) => s.c`insert into public.audit_logs(org_id, action) values (${ORG}, 'forged')`,
      ),
      reopen: await sqlstate(
        "OWNER",
        (s) => s.c`delete from public.pos_sale_key_voids where org_id = ${ORG}`,
      ),
      edit_order: await sqlstate(
        "OWNER",
        (s) => s.c`update public.orders set total_cents = 1 where id = ${saleId}`,
      ),
    };
    const after = await totals();
    const [o] = await sql`select total_cents from public.orders where id = ${saleId}`;
    // The refusal of the UPDATE depends on the privilege model of THIS database, read from it: hosted has
    // no UPDATE privilege on orders (42501); the cli model has it and RLS (no write policy) matches no row.
    // The INSERTs and the DELETE are 42501 in both (no privilege, or RLS / explicit REVOKE).
    const [{ can_update: cliModel }] =
      await sql`select has_table_privilege('authenticated', 'public.orders', 'UPDATE') as can_update`;
    const expectedWrites = {
      order: "42501",
      payment: "42501",
      ledger: "42501",
      audit: "42501",
      reopen: "42501",
      edit_order: cliModel ? "rows:0" : "42501",
    };
    check(
      `T2 nobody writes orders, payments, the ledger, the audit or the closed keys directly, owners included (${cliModel ? "cli" : "hosted"} model); nothing changed`,
      JSON.stringify(w) === JSON.stringify(expectedWrites) &&
        after === before &&
        o.total_cents === 433 &&
        (await state(kClosed)).closed === 1,
      JSON.stringify(w),
    );
  }
} catch (e) {
  check("script error", false, code(e));
} finally {
  try {
    await sql`set lock_timeout = '30s'`; // a leftover lock fails the cleanup instead of hanging the job
    await sql`delete from public.user_roles where user_id = ${U.PLAT}`;
    await sql.unsafe(dropIsolatedOrgsSql([A.orgId, B.orgId]));
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([A.orgId, B.orgId]).replace(/;\s*$/, "")}) x(n)`,
    );
    check("cleanup: nothing of the test organizations is left", Number(n) === 0, String(n));
  } catch (e) {
    check("cleanup", false, code(e));
  }
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`POS sale flow integrity: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
