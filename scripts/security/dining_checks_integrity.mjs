// Dining room step 2 (0038): sessions, checks and rounds sent to the kitchen. LOCAL/CI QA stack ONLY
// (the target guard refuses any other database). Direct RPC calls and reads as each member, in real
// PostgreSQL sessions (SET ROLE authenticated + JWT claims: RLS and the security-definer checks run as
// in the API).
//
//   O  opening a table: who may, idempotent replay, one open session per table, a reserved table can
//      be seated, the table stays occupied while the session is open (status change and archive refused)
//   R  rounds: server-side prices and the store tax, kitchen status "new", ingredients consumed at once,
//      NO payment and NO revenue; replay consumes nothing twice; pos.sell required; wrong tax rate,
//      unknown product and insufficient stock refuse the whole round (nothing written); a key reused
//      on another check is refused
//   V  voiding a round (cancel_order_with_reversal, orders.refund) returns the ingredients
//   M  moving the party and closing a session with nothing to pay; a closed check takes no round
//   S  several checks at one table (each person or group its own bill): numbered, optionally named,
//      idempotent; each round goes to one check and its kitchen ticket names the check; totals stay
//      per check; who may open one; two checks opened at once get different numbers
//   K  concurrency (two sessions, COMMIT and ROLLBACK): two parties for one table; a round vs closing
//      the session, both orders; the same round sent twice at once
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/dining_checks_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:dining-checks").catch(exitOnRefusal);

const RATE = 70000; // 7%
const KEYS = ["OWNER", "MGR", "MGROUT", "CASH", "VIEW", "KITCH", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("checks-a", {
  taxRatePpm: RATE,
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.MGR, role: "manager", store: true },
    { userId: U.MGROUT, role: "manager", store: false },
    { userId: U.CASH, role: "staff", store: true },
    { userId: U.VIEW, role: "staff", store: true },
    { userId: U.KITCH, role: "staff", store: true },
  ],
});
const B = isolatedOrg("checks-b", {
  taxRatePpm: RATE,
  members: [{ userId: U.OWNERB, role: "owner" }],
});
const S1 = A.locationId;
const ORG = A.orgId;
const ORGS = [A.orgId, B.orgId];
const mid = (uid) => A.members.find((m) => m.userId === uid).memberId;
const PRODUCT = `ck-soda-${A.key}`;

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const code = (e) => String(e?.message ?? e).split("\n")[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
const key = () => crypto.randomUUID();

async function session(userId, { role = "authenticated" } = {}) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  if (userId) {
    await c`select set_config('request.jwt.claim.sub', ${userId}, false)`;
    await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role })}, false)`;
  }
  await c`set lock_timeout = '20s'`;
  await c.unsafe(`set role ${role}`);
  const [{ pid }] = await c`select pg_backend_pid() as pid`;
  return { c, pid, end: () => c.end({ timeout: 5 }) };
}
async function as(uid, fn, opts) {
  const s = await session(uid, opts);
  try {
    return await fn(s.c);
  } catch (e) {
    return code(e);
  } finally {
    await s.end();
  }
}
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

const open = (c, table, guests, k, server = null, org = ORG, store = S1) =>
  c`select public.open_dining_session(${org}, ${store}, ${table}, ${guests}, ${k}, ${server}) as id`.then(
    (r) => r[0].id,
  );
const fire = (c, checkId, k, qty = 1, rate = RATE, product = PRODUCT) =>
  c`select public.fire_check_round(${ORG}, ${S1}, ${checkId}, ${k},
      ${c.json([{ product_id: product, quantity: qty, modifiers: [] }])}, ${rate}) as id`.then(
    (r) => r[0].id,
  );
const move = (c, sessionId, to) =>
  c`select public.move_dining_session(${ORG}, ${S1}, ${sessionId}, ${to})`.then(() => "ok");
const openCheck = (c, sessionId, k, label = null, org = ORG) =>
  c`select public.open_dining_check(${org}, ${S1}, ${sessionId}, ${k}, ${label}) as id`.then(
    (r) => r[0].id,
  );
const closeEmpty = (c, sessionId) =>
  c`select public.close_empty_dining_session(${ORG}, ${S1}, ${sessionId})`.then(() => "ok");
const voidRound = (c, orderId) =>
  c`select public.cancel_order_with_reversal(${orderId}, 'Sent by mistake')`.then(() => "ok");
const status = async (tableId) =>
  (await sql`select status from public.dining_tables where id = ${tableId}`)[0].status;
const checkOf = async (sessionId) =>
  (await sql`select id from public.dining_checks where session_id = ${sessionId}`)[0].id;
let SYRUP;
const stock = async () =>
  Number((await sql`select quantity from public.inventory_items where id = ${SYRUP}`)[0].quantity);

/** Everything a refused call must leave untouched. */
const state = async () =>
  JSON.stringify(
    await sql`select
      (select count(*)::int from public.dining_sessions where org_id = any(${ORGS})) as sessions,
      (select coalesce(json_agg(json_build_object('id', id, 's', status) order by id), '[]') from public.dining_checks where org_id = any(${ORGS})) as checks,
      (select count(*)::int from public.dining_check_rounds where org_id = any(${ORGS})) as rounds,
      (select count(*)::int from public.orders where org_id = any(${ORGS})) as orders,
      (select coalesce(sum(quantity), 0)::text from public.inventory_items where org_id = any(${ORGS})) as stock,
      (select coalesce(json_agg(json_build_object('id', id, 's', status) order by id), '[]') from public.dining_tables where org_id = any(${ORGS})) as tables,
      (select count(*)::int from public.finance_entries where org_id = any(${ORGS})) as ledger,
      (select count(*)::int from public.payments where org_id = any(${ORGS})) as payments`,
  );
async function refused(name, expected, uid, fn, opts) {
  const before = await state();
  const r = await as(uid, fn, opts);
  const same = (await state()) === before;
  const ok = (expected instanceof RegExp ? expected.test(String(r)) : r === expected) && same;
  check(name, ok, `${r}${same ? "" : " — STATE CHANGED"}`);
}

try {
  // ---------------------------------------------------------------- fixture
  await sql.unsafe(
    createTestUsersSql(
      KEYS.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  for (const o of ORGS)
    await sql`insert into public.org_features (org_id, feature, enabled) values (${o}, 'table_service', true)
              on conflict (org_id, feature) do update set enabled = true`;
  const profile = async (k) =>
    (await sql`select id from public.permission_profiles where is_system and key = ${k}`)[0].id;
  await sql`update public.organization_members set profile_id = ${await profile("cashier")} where id = ${mid(U.CASH)}`;
  await sql`update public.organization_members set profile_id = ${await profile("kitchen")},
              extra_permissions = array['tables.serve'] where id = ${mid(U.KITCH)}`;
  await sql`update public.organization_members set extra_permissions = array['tables.view'],
              revoked_permissions = array['tables.serve'] where id = ${mid(U.VIEW)}`;
  await sql`update public.organization_members
               set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions)
             where org_id = ${ORG}`;
  await as(U.OWNER, async (c) => {
    await c`select public.save_operational_menu(${ORG}, 'category', ${c.json({ op: "create", id: `ck-drinks-${A.key}`, name: "Drinks" })})`;
    await c`select public.save_operational_menu(${ORG}, 'product', ${c.json({ id: PRODUCT, name: "Check soda", category: `ck-drinks-${A.key}`, priceCents: 400, prepTimeMinutes: 1, locationIds: [], modifierGroups: [] })})`;
  });
  const [{ id: productId }] =
    await sql`select id from public.menu_products where org_id = ${ORG} and client_id = ${PRODUCT}`;
  [{ id: SYRUP }] =
    await sql`insert into public.inventory_items (org_id, location_id, client_id, name, unit, quantity, cost_cents)
      values (${ORG}, ${S1}, ${`ck-syrup-${A.key}`}, 'Syrup', 'units', 10, 50) returning id`;
  const [{ id: recipe }] =
    await sql`insert into public.product_recipes (org_id, product_id, location_id, servings)
      values (${ORG}, ${productId}, ${S1}, 1) returning id`;
  await sql`insert into public.recipe_ingredients (org_id, location_id, recipe_id, inventory_item_id, quantity, unit)
            values (${ORG}, ${S1}, ${recipe}, ${SYRUP}, 1, 'units')`;
  const table = (label) =>
    as(U.OWNER, (c) =>
      c`select public.save_dining_table(${ORG}, ${S1}, ${label}, 4) as id`.then((r) => r[0].id),
    );
  const T1 = await table("T1");
  const T2 = await table("T2");
  const T3 = await table("T3");
  const T4 = await table("T4");
  const [{ id: TB }] = await as(
    U.OWNERB,
    (c) => c`select public.save_dining_table(${B.orgId}, ${B.locationId}, 'B1', 4) as id`,
  );
  check("fixture: three tables, a product with a one-unit recipe, 10 units of stock", isUuid(TB));

  // ---------------------------------------------------------------- O. opening a table
  const k1 = key();
  const S_T1 = await as(U.CASH, (c) => open(c, T1, 2, k1));
  check("O1 the cashier profile opens T1 for 2 guests", isUuid(S_T1), String(S_T1));
  check(
    "O1 T1 is occupied and has one open check",
    (await status(T1)) === "occupied" && isUuid(await checkOf(S_T1)),
  );
  const [{ server }] =
    await sql`select server_id::text as server from public.dining_sessions where id = ${S_T1}`;
  check("O1 the server defaults to whoever opened it", server === U.CASH);
  check(
    "O2 replaying the same key returns the same session",
    (await as(U.CASH, (c) => open(c, T1, 2, k1))) === S_T1 &&
      (await sql`select count(*)::int n from public.dining_sessions where table_id = ${T1}`)[0]
        .n === 1,
  );
  await refused(
    "O3 a second party for an occupied table is refused",
    "table_not_available",
    U.MGR,
    (c) => open(c, T1, 3, key()),
  );
  await refused(
    "O4 while the session is open the table cannot be marked available",
    "table_has_open_check",
    U.MGR,
    (c) => c`select public.set_dining_table_status(${ORG}, ${S1}, ${T1}, 'available', 'occupied')`,
  );
  await refused(
    "O5 ...nor archived",
    "table_occupied",
    U.OWNER,
    (c) => c`select public.archive_dining_table(${ORG}, ${S1}, ${T1})`,
  );
  await refused(
    "O6 view only (tables.serve revoked) cannot open a table",
    "permission_denied",
    U.VIEW,
    (c) => open(c, T2, 2, key()),
  );
  check(
    "O6 ...but reads the open session",
    (await as(U.VIEW, (c) => c`select id::text from public.dining_sessions`)).some?.(
      (r) => r.id === S_T1,
    ),
  );
  await refused("O7 a manager without the store is refused", "forbidden", U.MGROUT, (c) =>
    open(c, T2, 2, key()),
  );
  await refused("O7 another organization's owner is refused", "forbidden", U.OWNERB, (c) =>
    open(c, T2, 2, key()),
  );
  check(
    "O7 another organization's owner reads no session of A",
    (await as(U.OWNERB, (c) => c`select id from public.dining_sessions where org_id = ${ORG}`))
      .length === 0,
  );
  await refused(
    "O7 anon cannot call it",
    /permission denied for function/,
    null,
    (c) => open(c, T2, 2, key()),
    {
      role: "anon",
    },
  );
  await refused("O8 zero guests", "invalid_guests", U.CASH, (c) => open(c, T2, 0, key()));
  await refused("O8 a server from another organization", "invalid_server", U.CASH, (c) =>
    open(c, T2, 2, key(), U.OWNERB),
  );
  await refused("O8 a manager without the store as server", "invalid_server", U.CASH, (c) =>
    open(c, T2, 2, key(), U.MGROUT),
  );
  await refused(
    "O9 no direct insert of a session",
    /permission denied/,
    U.OWNER,
    (c) =>
      c`insert into public.dining_sessions (org_id, location_id, table_id, guests, server_id, client_key, opened_by)
      values (${ORG}, ${S1}, ${T2}, 2, ${U.OWNER}, 'x', ${U.OWNER})`,
  );
  await as(
    U.CASH,
    (c) => c`select public.set_dining_table_status(${ORG}, ${S1}, ${T3}, 'reserved')`,
  );
  const S_T3 = await as(U.CASH, (c) => open(c, T3, 4, key(), U.MGR));
  check(
    "O10 a reserved table is seated (server chosen: the store manager)",
    isUuid(S_T3) && (await status(T3)) === "occupied",
    String(S_T3),
  );

  // ---------------------------------------------------------------- R. rounds
  const C1 = await checkOf(S_T1);
  const stock0 = await stock();
  const r1k = key();
  const R1 = await as(U.CASH, (c) => fire(c, C1, r1k, 2));
  check("R1 the cashier sends 2 sodas to the kitchen", isUuid(R1), String(R1));
  const [o1] =
    await sql`select type, status, table_number, subtotal_cents, tax_cents, total_cents from public.orders where id = ${R1}`;
  check(
    "R1 it is a dine-in kitchen order at server prices and the store tax (800 + 56)",
    o1.type === "dine_in" &&
      o1.status === "new" &&
      o1.table_number === "T1" &&
      o1.subtotal_cents === 800 &&
      o1.tax_cents === 56 &&
      o1.total_cents === 856,
    JSON.stringify(o1),
  );
  check(
    "R1 the ingredients are consumed at once (10 -> 8)",
    stock0 === 10 && (await stock()) === 8,
  );
  const [{ pay, led }] =
    await sql`select (select count(*)::int from public.payments where order_id = ${R1}) as pay,
      (select count(*)::int from public.finance_entries where order_id = ${R1}) as led`;
  check("R1 no payment and no revenue for an unpaid round", pay === 0 && led === 0);
  check(
    "R2 replaying the round returns the same order and consumes nothing twice",
    (await as(U.CASH, (c) => fire(c, C1, r1k, 2))) === R1 &&
      (await stock()) === 8 &&
      (await sql`select count(*)::int n from public.dining_check_rounds where check_id = ${C1}`)[0]
        .n === 1,
  );
  const R2 = await as(U.MGR, (c) => fire(c, C1, key(), 1));
  const [{ no }] =
    await sql`select round_no as no from public.dining_check_rounds where order_id = ${R2}`;
  check("R3 a second round is round 2 (stock 7)", no === 2 && (await stock()) === 7);
  await refused(
    "R4 serving without pos.sell (kitchen profile + tables.serve) is refused",
    "permission_denied",
    U.KITCH,
    (c) => fire(c, C1, key(), 1),
  );
  await refused("R5 a stale tax rate refuses the round", "tax_rate_changed", U.CASH, (c) =>
    fire(c, C1, key(), 1, 80000),
  );
  await refused("R6 an unknown product refuses the round", "product_not_in_store", U.CASH, (c) =>
    fire(c, C1, key(), 1, RATE, "nope"),
  );
  await refused(
    "R7 not enough stock refuses the whole round (no order, no movement)",
    "insufficient_stock",
    U.CASH,
    (c) => fire(c, C1, key(), 50),
  );
  await refused(
    "R8 a round key reused on another check is refused",
    "idempotency_conflict",
    U.CASH,
    async (c) => fire(c, await checkOf(S_T3), r1k, 2),
  );
  await refused(
    "R9 no direct insert of a round",
    /permission denied/,
    U.OWNER,
    (c) =>
      c`insert into public.dining_check_rounds (org_id, location_id, check_id, order_id, round_no, fired_by)
      values (${ORG}, ${S1}, ${C1}, ${R1}, 9, ${U.OWNER})`,
  );

  // ---------------------------------------------------------------- V. void a round
  await refused(
    "V1 the cashier profile cannot void a round (orders.refund)",
    "permission_denied",
    U.CASH,
    (c) => voidRound(c, R2),
  );
  check(
    "V2 the manager voids round 2: the ingredient comes back (7 -> 8)",
    (await as(U.MGR, (c) => voidRound(c, R2))) === "ok" && (await stock()) === 8,
  );

  // ---------------------------------------------------------------- M. move and close
  await refused(
    "M1 a session with a live round cannot be closed as empty",
    "check_has_items",
    U.CASH,
    (c) => closeEmpty(c, S_T1),
  );
  check(
    "M2 moving the party T1 -> T2: T1 to cleaning, T2 occupied",
    (await as(U.CASH, (c) => move(c, S_T1, T2))) === "ok" &&
      (await status(T1)) === "cleaning" &&
      (await status(T2)) === "occupied",
  );
  await refused("M3 moving onto an occupied table is refused", "table_not_available", U.CASH, (c) =>
    move(c, S_T1, T3),
  );
  check(
    "M4 the session with nothing ordered closes; T3 goes to cleaning",
    (await as(U.CASH, (c) => closeEmpty(c, S_T3))) === "ok" && (await status(T3)) === "cleaning",
  );
  const C3 = await checkOf(S_T3);
  const [{ cs }] = await sql`select status as cs from public.dining_checks where id = ${C3}`;
  check("M4 its check is void", cs === "void");
  await refused("M5 a closed check takes no round", "check_not_open", U.CASH, (c) =>
    fire(c, C3, key(), 1),
  );
  check(
    "M6 replaying round 1 after the move still returns round 1",
    (await as(U.CASH, (c) => fire(c, C1, r1k, 2))) === R1,
  );
  await as(U.MGR, (c) => voidRound(c, R1));
  check(
    "M7 once every round is voided the session closes (stock back to 10, T2 cleaning)",
    (await as(U.CASH, (c) => closeEmpty(c, S_T1))) === "ok" &&
      (await stock()) === 10 &&
      (await status(T2)) === "cleaning",
  );
  const [{ led2, pay2 }] =
    await sql`select (select count(*)::int from public.finance_entries where org_id = ${ORG}) as led2,
      (select count(*)::int from public.payments where org_id = ${ORG}) as pay2`;
  check("M8 nothing reached the ledger or payments", led2 === 0 && pay2 === 0);
  const audit = await sql`select action, location_id::text as loc from public.audit_logs
                           where org_id = ${ORG} and action like 'tables.session%' or (org_id = ${ORG} and action = 'tables.round_fired')`;
  const acts = new Set(audit.map((a) => a.action));
  check(
    "M9 opened, fired, moved and closed are audited at the store",
    [
      "tables.session_opened",
      "tables.round_fired",
      "tables.session_moved",
      "tables.session_closed_empty",
    ].every((a) => acts.has(a)) && audit.every((a) => a.loc === S1),
    `${audit.length} rows`,
  );

  // ---------------------------------------------------------------- S. several checks at one table
  await as(
    U.MGR,
    (c) => c`select public.set_dining_table_status(${ORG}, ${S1}, ${T3}, 'available')`,
  );
  const S_SPLIT = await as(U.CASH, (c) => open(c, T3, 3, key()));
  const CH1 = await checkOf(S_SPLIT);
  const kAna = key();
  const CH2 = await as(U.CASH, (c) => openCheck(c, S_SPLIT, kAna, "Ana"));
  const [c2] = await sql`select number, label from public.dining_checks where id = ${CH2}`;
  check(
    "S1 a second check at the same table: number 2, named Ana",
    c2?.number === 2 && c2?.label === "Ana",
    JSON.stringify(c2),
  );
  check(
    "S2 replaying it returns the same check",
    (await as(U.CASH, (c) => openCheck(c, S_SPLIT, kAna, "Ana"))) === CH2,
  );
  const CH3 = await as(U.MGR, (c) => openCheck(c, S_SPLIT, key()));
  const [c3] = await sql`select number, label from public.dining_checks where id = ${CH3}`;
  check("S3 a third check without a name: number 3", c3?.number === 3 && c3?.label === null);
  const RA = await as(U.CASH, (c) => fire(c, CH2, key(), 2));
  const R3 = await as(U.CASH, (c) => fire(c, CH3, key(), 1));
  const R1s = await as(U.CASH, (c) => fire(c, CH1, key(), 1));
  const tickets =
    await sql`select id, customer_name, table_number from public.orders where id in (${RA}, ${R3}, ${R1s})`;
  const nameOf = (id) => tickets.find((x) => x.id === id)?.customer_name;
  const tableOf = (id) => tickets.find((x) => x.id === id)?.table_number;
  check(
    "S4 each kitchen ticket names its check, in the name and the table field the KDS shows (check 1 stays plain)",
    nameOf(RA) === "Table T3 · Ana" &&
      nameOf(R3) === "Table T3 · Check 3" &&
      nameOf(R1s) === "Table T3" &&
      tableOf(RA) === "T3 · Ana" &&
      tableOf(R3) === "T3 · Check 3" &&
      tableOf(R1s) === "T3",
    JSON.stringify(tickets.map((x) => [x.customer_name, x.table_number])),
  );
  const perCheck =
    await sql`select r.check_id, sum(o.total_cents)::int as total from public.dining_check_rounds r
      join public.orders o on o.id = r.order_id where r.check_id in (${CH1}, ${CH2}, ${CH3}) group by r.check_id`;
  const totalOf = (id) => perCheck.find((x) => x.check_id === id)?.total;
  check(
    "S5 totals stay per check (Ana 856, check 3 428, check 1 428)",
    totalOf(CH2) === 856 && totalOf(CH3) === 428 && totalOf(CH1) === 428,
    JSON.stringify(perCheck),
  );
  await refused("S6 view only cannot open a check", "permission_denied", U.VIEW, (c) =>
    openCheck(c, S_SPLIT, key()),
  );
  await refused("S6 another organization's owner cannot", "forbidden", U.OWNERB, (c) =>
    openCheck(c, S_SPLIT, key()),
  );
  await refused("S7 a name over 40 characters", "invalid_label", U.CASH, (c) =>
    openCheck(c, S_SPLIT, key(), "x".repeat(41)),
  );
  await as(
    U.MGR,
    (m) => m`select public.set_dining_table_status(${ORG}, ${S1}, ${T1}, 'available')`,
  );
  const OTHER = await as(U.CASH, (c) => open(c, T1, 2, key()));
  await refused(
    "S8 a check key reused on another session is refused",
    "idempotency_conflict",
    U.CASH,
    (c) => openCheck(c, OTHER, kAna, "Ana"),
  );
  await as(U.CASH, (c) => closeEmpty(c, OTHER));
  await refused(
    "S9 the session cannot close empty while any check has a live round",
    "check_has_items",
    U.CASH,
    (c) => closeEmpty(c, S_SPLIT),
  );
  {
    const a = await session(U.CASH);
    const b = await session(U.MGR);
    await a.c`begin`;
    const n1 = await openCheck(a.c, S_SPLIT, key()).catch(code);
    const attempt = openCheck(b.c, S_SPLIT, key()).catch(code);
    const waited = await blockedBy(b.pid, a.pid);
    await a.c`commit`;
    const n2 = await attempt;
    const nums = (
      await sql`select number from public.dining_checks where id in (${n1}, ${n2}) order by number`
    ).map((x) => x.number);
    check(
      "S10 two checks opened at once get different numbers (4 and 5)",
      waited && JSON.stringify(nums) === "[4,5]",
      JSON.stringify(nums),
    );
    await a.end();
    await b.end();
  }
  for (const r of [RA, R3, R1s]) await as(U.MGR, (c) => voidRound(c, r));
  check(
    "S11 with every round voided the table closes; all its checks are void",
    (await as(U.CASH, (c) => closeEmpty(c, S_SPLIT))) === "ok" &&
      (
        await sql`select count(*)::int n from public.dining_checks where session_id = ${S_SPLIT} and status <> 'void'`
      )[0].n === 0,
  );
  await refused("S12 no new check on a closed session", "session_not_found", U.CASH, (c) =>
    openCheck(c, S_SPLIT, key()),
  );

  // ---------------------------------------------------------------- K. concurrency
  for (const end of ["commit", "rollback"]) {
    await as(
      U.MGR,
      (c) => c`select public.set_dining_table_status(${ORG}, ${S1}, ${T4}, 'available')`,
    );
    const first = await session(U.CASH);
    const second = await session(U.MGR);
    await first.c`begin`;
    const r1 = await open(first.c, T4, 2, key()).catch(code);
    const attempt = open(second.c, T4, 3, key()).catch(code);
    const waited = await blockedBy(second.pid, first.pid);
    await first.c.unsafe(end);
    const r2 = await attempt;
    const [{ n }] =
      await sql`select count(*)::int n from public.dining_sessions where table_id = ${T4} and status = 'open'`;
    check(
      `K1 ${end.toUpperCase()}: two parties for one table: ${end === "commit" ? "the second is refused" : "the second gets it"}`,
      waited &&
        isUuid(r1) &&
        n === 1 &&
        (end === "commit" ? r2 === "table_not_available" : isUuid(r2)),
      `${waited} ${r2}`,
    );
    const open4 = (
      await sql`select id from public.dining_sessions where table_id = ${T4} and status = 'open'`
    )[0].id;
    await as(U.CASH, (c) => closeEmpty(c, open4));
    await first.end();
    await second.end();
  }
  for (const [order, end] of [
    ["round first", "commit"],
    ["round first", "rollback"],
    ["close first", "commit"],
    ["close first", "rollback"],
  ]) {
    await as(
      U.MGR,
      (c) => c`select public.set_dining_table_status(${ORG}, ${S1}, ${T4}, 'available')`,
    );
    const sid = await as(U.CASH, (c) => open(c, T4, 2, key()));
    const cid = await checkOf(sid);
    const before = await stock();
    const first = await session(U.CASH);
    const second = await session(U.MGR);
    await first.c`begin`;
    const r1 =
      order === "round first"
        ? await fire(first.c, cid, key(), 1).catch(code)
        : await closeEmpty(first.c, sid).catch(code);
    const attempt =
      order === "round first"
        ? closeEmpty(second.c, sid).catch(code)
        : fire(second.c, cid, key(), 1).catch(code);
    const waited = await blockedBy(second.pid, first.pid);
    await first.c.unsafe(end);
    const r2 = await attempt;
    const [row] = await sql`select s.status as session,
        (select count(*)::int from public.dining_check_rounds r join public.orders o on o.id = r.order_id where r.check_id = ${cid} and o.status <> 'cancelled') as live
        from public.dining_sessions s where s.id = ${sid}`;
    const after = await stock();
    let ok;
    if (order === "round first" && end === "commit")
      ok =
        isUuid(r1) &&
        r2 === "check_has_items" &&
        row.session === "open" &&
        row.live === 1 &&
        after === before - 1;
    else if (order === "round first")
      ok =
        isUuid(r1) && r2 === "ok" && row.session === "closed" && row.live === 0 && after === before;
    else if (end === "commit")
      ok =
        r1 === "ok" &&
        r2 === "check_not_open" &&
        row.session === "closed" &&
        row.live === 0 &&
        after === before;
    else
      ok =
        r1 === "ok" &&
        isUuid(r2) &&
        row.session === "open" &&
        row.live === 1 &&
        after === before - 1;
    check(
      `K2 ${order}, ${end.toUpperCase()}: never a live round on a closed session, stock consistent`,
      waited && ok,
      `${waited} ${r1} ${r2} ${JSON.stringify(row)} ${before}->${after}`,
    );
    await first.end();
    await second.end();
    // leave T4 free for the next case
    const [{ st }] = await sql`select status as st from public.dining_sessions where id = ${sid}`;
    if (st === "open") {
      for (const r of await sql`select r.order_id from public.dining_check_rounds r join public.orders o on o.id = r.order_id where r.check_id = ${cid} and o.status <> 'cancelled'`)
        await as(U.MGR, (c) => voidRound(c, r.order_id));
      await as(U.CASH, (c) => closeEmpty(c, sid));
    }
  }
  {
    await as(
      U.MGR,
      (c) => c`select public.set_dining_table_status(${ORG}, ${S1}, ${T4}, 'available')`,
    );
    const sid = await as(U.CASH, (c) => open(c, T4, 2, key()));
    const cid = await checkOf(sid);
    const before = await stock();
    const k = key();
    const [a, b] = await Promise.all([
      as(U.CASH, (c) => fire(c, cid, k, 1)),
      as(U.MGR, (c) => fire(c, cid, k, 1)),
    ]);
    const [{ n }] =
      await sql`select count(*)::int n from public.dining_check_rounds where check_id = ${cid}`;
    check(
      "K3 the same round sent twice at once: one order, one round, consumed once",
      isUuid(a) && a === b && n === 1 && (await stock()) === before - 1,
      `${a} ${b} ${n}`,
    );
  }
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
    await sql.unsafe(dropIsolatedOrgsSql(ORGS));
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql(ORGS).replace(/;\s*$/, "")}) x(n)`,
    );
    check("cleanup: nothing of the isolated organizations is left", Number(n) === 0, `${n} rows`);
  } catch (e) {
    check("cleanup", false, code(e));
  }
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok);
console.log(`Dining room checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
