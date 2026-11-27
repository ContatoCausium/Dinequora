// Dining room step 3 (0039): paying and closing checks. LOCAL/CI QA stack ONLY (the target guard refuses
// any other database). Direct RPC calls and reads as each member, in real PostgreSQL sessions.
//
//   P  tenders: partial and final payment, cash change, tip outside revenue, replay, refusals that
//      write nothing (over the balance, zero, bad tendered, bad method, empty check, who may)
//   C  closing: one allocation row per round in payments (the tender method, or "mixed"), revenue and
//      COGS posted once with the POS keys, the session and the table close with the last check, empty
//      checks voided, separate checks of one table closed one by one
//   V  voids: a round of a check with a tender, or of a closed check, cannot be voided; a tender can be
//      reversed on an open check only (orders.refund, reason required); a POS sale still cancels
//   M  moving a round between checks of the same table (not with tenders, not to another table)
//   K  concurrency (two sessions): two payments for the same balance; a payment vs voiding a round, both
//      orders: never paid more than the check, never revenue twice, never a voided round on a paid check
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/dining_payments_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:dining-payments").catch(exitOnRefusal);

const RATE = 70000; // 7%: one soda 400 + 28 = 428
const KEYS = ["OWNER", "MGR", "CASH", "VIEW", "KITCH", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("pay-a", {
  taxRatePpm: RATE,
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.MGR, role: "manager", store: true },
    { userId: U.CASH, role: "staff", store: true },
    { userId: U.VIEW, role: "staff", store: true },
    { userId: U.KITCH, role: "staff", store: true },
  ],
});
const B = isolatedOrg("pay-b", {
  taxRatePpm: RATE,
  members: [{ userId: U.OWNERB, role: "owner" }],
});
const S1 = A.locationId;
const ORG = A.orgId;
const ORGS = [A.orgId, B.orgId];
const mid = (uid) => A.members.find((m) => m.userId === uid).memberId;
const PRODUCT = `pay-soda-${A.key}`;

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

const open = (c, table, guests = 2) =>
  c`select public.open_dining_session(${ORG}, ${S1}, ${table}, ${guests}, ${key()}) as id`.then(
    (r) => r[0].id,
  );
const openCheck = (c, sid, label = null) =>
  c`select public.open_dining_check(${ORG}, ${S1}, ${sid}, ${key()}, ${label}) as id`.then(
    (r) => r[0].id,
  );
const fire = (c, checkId, qty = 1) =>
  c`select public.fire_check_round(${ORG}, ${S1}, ${checkId}, ${key()},
      ${c.json([{ product_id: PRODUCT, quantity: qty, modifiers: [] }])}, ${RATE}) as id`.then(
    (r) => r[0].id,
  );
const pay = (c, checkId, method, amount, { tip = 0, tendered = null, k = key(), org = ORG } = {}) =>
  c`select public.pay_dining_check(${org}, ${S1}, ${checkId}, ${k}, ${method}, ${amount}, ${tip}, ${tendered}) as r`.then(
    (r) => r[0].r,
  );
const voidRound = (c, orderId) =>
  c`select public.cancel_order_with_reversal(${orderId}, 'Sent by mistake')`.then(() => "ok");
const voidTender = (c, pid, reason = "Wrong card charged") =>
  c`select public.void_check_payment(${ORG}, ${S1}, ${pid}, ${reason})`.then(() => "ok");
const moveRound = (c, orderId, to) =>
  c`select public.move_check_round(${ORG}, ${S1}, ${orderId}, ${to})`.then(() => "ok");
const checkOf = async (sid) =>
  (await sql`select id from public.dining_checks where session_id = ${sid} and number = 1`)[0].id;
const checkStatus = async (id) =>
  (await sql`select status from public.dining_checks where id = ${id}`)[0].status;
const tableStatus = async (id) =>
  (await sql`select status from public.dining_tables where id = ${id}`)[0].status;
const sessionStatus = async (id) =>
  (await sql`select status from public.dining_sessions where id = ${id}`)[0].status;
const ledger = async (orderIds) =>
  sql`select order_id, kind, amount_cents from public.finance_entries
       where order_id = any(${orderIds}) order by order_id, kind`;
const allocations = async (orderIds) =>
  sql`select order_id, method, amount_cents, status from public.payments where order_id = any(${orderIds}) order by order_id`;

const state = async () =>
  JSON.stringify(
    await sql`select
      (select coalesce(json_agg(json_build_object('id', id, 's', status) order by id), '[]') from public.dining_checks where org_id = any(${ORGS})) as checks,
      (select coalesce(json_agg(json_build_object('id', id, 's', status) order by id), '[]') from public.dining_check_payments where org_id = any(${ORGS})) as tenders,
      (select count(*)::int from public.payments where org_id = any(${ORGS})) as payments,
      (select count(*)::int from public.finance_entries where org_id = any(${ORGS})) as ledger,
      (select coalesce(json_agg(json_build_object('id', id, 's', status) order by id), '[]') from public.orders where org_id = any(${ORGS})) as orders,
      (select coalesce(json_agg(json_build_object('id', id, 'c', check_id) order by id), '[]') from public.dining_check_rounds where org_id = any(${ORGS})) as rounds,
      (select coalesce(sum(quantity), 0)::text from public.inventory_items where org_id = any(${ORGS})) as stock`,
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
    await c`select public.save_operational_menu(${ORG}, 'category', ${c.json({ op: "create", id: `pay-drinks-${A.key}`, name: "Drinks" })})`;
    await c`select public.save_operational_menu(${ORG}, 'product', ${c.json({ id: PRODUCT, name: "Pay soda", category: `pay-drinks-${A.key}`, priceCents: 400, prepTimeMinutes: 1, locationIds: [], modifierGroups: [] })})`;
  });
  const [{ id: productId }] =
    await sql`select id from public.menu_products where org_id = ${ORG} and client_id = ${PRODUCT}`;
  const [{ id: syrup }] =
    await sql`insert into public.inventory_items (org_id, location_id, client_id, name, unit, quantity, cost_cents)
      values (${ORG}, ${S1}, ${`pay-syrup-${A.key}`}, 'Syrup', 'units', 100, 50) returning id`;
  const [{ id: recipe }] =
    await sql`insert into public.product_recipes (org_id, product_id, location_id, servings)
      values (${ORG}, ${productId}, ${S1}, 1) returning id`;
  await sql`insert into public.recipe_ingredients (org_id, location_id, recipe_id, inventory_item_id, quantity, unit)
            values (${ORG}, ${S1}, ${recipe}, ${syrup}, 1, 'units')`;
  const table = (label) =>
    as(U.OWNER, (c) =>
      c`select public.save_dining_table(${ORG}, ${S1}, ${label}, 4) as id`.then((r) => r[0].id),
    );
  const [T1, T2, T3, T4, T5] = [
    await table("T1"),
    await table("T2"),
    await table("T3"),
    await table("T4"),
    await table("T5"),
  ];
  check("fixture: five tables, a 400 product with a one-unit recipe (cost 50)", isUuid(T5));

  // ---------------------------------------------------------------- P. tenders
  const S_1 = await as(U.CASH, (c) => open(c, T1));
  const C1 = await checkOf(S_1);
  const R1 = await as(U.CASH, (c) => fire(c, C1, 2)); // 800 + 56 = 856
  const kPart = key();
  const p1 = await as(U.CASH, (c) => pay(c, C1, "card", 400, { k: kPart, tip: 80 }));
  check(
    "P1 a partial card payment (400 + 80 tip) leaves the check open with 456 to pay",
    p1?.check_status === "open" && p1?.balance_cents === 456,
    JSON.stringify(p1),
  );
  check(
    "P1 nothing is allocated or posted to the ledger before the check closes",
    (await allocations([R1])).length === 0 && (await ledger([R1])).length === 0,
  );
  const again = await as(U.CASH, (c) => pay(c, C1, "card", 400, { k: kPart, tip: 80 }));
  check(
    "P2 replaying the tender returns it, nothing new",
    again?.payment === p1?.payment && again?.balance_cents === 456,
  );
  await refused(
    "P2 the same key with another amount is refused",
    "idempotency_conflict",
    U.CASH,
    (c) => pay(c, C1, "card", 300, { k: kPart, tip: 80 }),
  );
  await refused("P3 more than the balance is refused", "payment_exceeds_balance", U.CASH, (c) =>
    pay(c, C1, "cash", 457),
  );
  await refused("P3 a zero amount is refused", "invalid_amount", U.CASH, (c) =>
    pay(c, C1, "cash", 0),
  );
  await refused("P3 cash handed over below amount + tip", "invalid_tendered", U.CASH, (c) =>
    pay(c, C1, "cash", 456, { tip: 10, tendered: 460 }),
  );
  await refused("P3 a tendered amount on a card payment", "invalid_tendered", U.CASH, (c) =>
    pay(c, C1, "card", 456, { tendered: 500 }),
  );
  await refused("P3 an unknown method", "invalid_payment", U.CASH, (c) =>
    pay(c, C1, "crypto", 456),
  );
  await refused("P4 view only cannot take a payment", "permission_denied", U.VIEW, (c) =>
    pay(c, C1, "cash", 456),
  );
  await refused(
    "P4 serving without pos.sell cannot take a payment",
    "permission_denied",
    U.KITCH,
    (c) => pay(c, C1, "cash", 456),
  );
  await refused("P4 another organization's owner is refused", "forbidden", U.OWNERB, (c) =>
    pay(c, C1, "cash", 456, { org: B.orgId }),
  );
  await refused(
    "P4 anon cannot call it",
    /permission denied for function/,
    null,
    (c) => pay(c, C1, "cash", 456),
    {
      role: "anon",
    },
  );
  await refused(
    "P4 no direct insert of a tender",
    /permission denied/,
    U.OWNER,
    (c) =>
      c`insert into public.dining_check_payments (org_id, location_id, check_id, method, amount_cents, client_key, created_by)
      values (${ORG}, ${S1}, ${C1}, 'cash', 1, 'x', ${U.OWNER})`,
  );
  await refused(
    "V1 a round of a check with a tender cannot be voided",
    "check_has_payments",
    U.MGR,
    (c) => voidRound(c, R1),
  );

  // ---------------------------------------------------------------- C. closing
  const p2 = await as(U.CASH, (c) => pay(c, C1, "cash", 456, { tendered: 500 }));
  check(
    "C1 the cash payment settles the check: closed, balance 0",
    p2?.check_status === "closed" && p2?.balance_cents === 0,
    JSON.stringify(p2),
  );
  const [tender] =
    await sql`select change_cents, tendered_cents from public.dining_check_payments where id = ${p2?.payment}`;
  check(
    "C1 change recorded (500 handed over, 44 back)",
    tender?.change_cents === 44 && tender?.tendered_cents === 500,
  );
  const alloc1 = await allocations([R1]);
  check(
    "C2 one allocation row for the round: 856, method mixed (card + cash)",
    alloc1.length === 1 &&
      alloc1[0].amount_cents === 856 &&
      alloc1[0].method === "mixed" &&
      alloc1[0].status === "recorded",
    JSON.stringify(alloc1),
  );
  const led1 = await ledger([R1]);
  check(
    "C3 revenue 800 (net of tax, tip excluded) and COGS 100 posted once",
    JSON.stringify(led1.map((x) => [x.kind, x.amount_cents])) ===
      JSON.stringify([
        ["cogs", 100],
        ["revenue", 800],
      ]),
    JSON.stringify(led1),
  );
  check(
    "C4 the only check closed: the session closes and the table goes to cleaning",
    (await sessionStatus(S_1)) === "closed" && (await tableStatus(T1)) === "cleaning",
  );
  await refused("C5 a closed check takes no payment", "check_not_open", U.CASH, (c) =>
    pay(c, C1, "cash", 1),
  );
  await refused("V2 a round of a closed check cannot be voided", "check_has_payments", U.MGR, (c) =>
    voidRound(c, R1),
  );
  check(
    "C6 replaying the settling tender after the close returns it, closed",
    (await as(U.CASH, (c) => pay(c, C1, "card", 400, { k: kPart, tip: 80 })))?.check_status ===
      "closed",
  );

  // single method, separate checks, empty checks
  const S_2 = await as(U.CASH, (c) => open(c, T2, 3));
  const C2a = await checkOf(S_2);
  const C2b = await as(U.CASH, (c) => openCheck(c, S_2, "Ana"));
  const C2c = await as(U.CASH, (c) => openCheck(c, S_2, "Nobody"));
  const R2a = await as(U.CASH, (c) => fire(c, C2a, 1)); // 428
  const R2b = await as(U.CASH, (c) => fire(c, C2b, 1)); // 428
  await refused("C7 an empty check cannot be paid", "check_empty", U.CASH, (c) =>
    pay(c, C2c, "card", 1),
  );
  const pa = await as(U.CASH, (c) => pay(c, C2a, "card", 428));
  check(
    "C8 check 1 paid by card alone: closed, allocation method card; the table stays open for Ana",
    pa?.check_status === "closed" &&
      (await allocations([R2a]))[0]?.method === "card" &&
      (await sessionStatus(S_2)) === "open" &&
      (await tableStatus(T2)) === "occupied",
  );
  const pb = await as(U.CASH, (c) => pay(c, C2b, "digital", 428, { tip: 64 }));
  check(
    "C9 Ana pays: the session closes, the empty check is voided, the table goes to cleaning",
    pb?.check_status === "closed" &&
      (await sessionStatus(S_2)) === "closed" &&
      (await checkStatus(C2c)) === "void" &&
      (await tableStatus(T2)) === "cleaning",
  );
  const led2 = await ledger([R2a, R2b]);
  check(
    "C10 each round posted once: revenue 400 + 400, COGS 50 + 50",
    led2.length === 4 &&
      led2.filter((x) => x.kind === "revenue").every((x) => x.amount_cents === 400) &&
      led2.filter((x) => x.kind === "cogs").every((x) => x.amount_cents === 50),
    JSON.stringify(led2),
  );

  // ---------------------------------------------------------------- V. tender reversal
  const S_3 = await as(U.CASH, (c) => open(c, T3));
  const C3 = await checkOf(S_3);
  const R3 = await as(U.CASH, (c) => fire(c, C3, 1)); // 428
  const p3 = await as(U.CASH, (c) => pay(c, C3, "card", 200));
  await refused(
    "V3 the cashier profile cannot reverse a tender (orders.refund)",
    "permission_denied",
    U.CASH,
    (c) => voidTender(c, p3.payment),
  );
  await refused("V3 a reason is required", "reason_required", U.MGR, (c) =>
    voidTender(c, p3.payment, " "),
  );
  check(
    "V4 the manager reverses the tender on the open check",
    (await as(U.MGR, (c) => voidTender(c, p3.payment))) === "ok",
  );
  check(
    "V4 the round can be voided again once no tender is recorded",
    (await as(U.MGR, (c) => voidRound(c, R3))) === "ok",
  );
  check(
    "V4 reversing twice is a no-op",
    (await as(U.MGR, (c) => voidTender(c, p3.payment))) === "ok",
  );
  await as(U.CASH, (c) => c`select public.close_empty_dining_session(${ORG}, ${S1}, ${S_3})`);

  // a POS sale (not a round) still cancels as before
  const posSale = await as(U.MGR, (c) =>
    c`select public.persist_finalized_pos_sale_atomic_v2(${ORG}, ${S1}, 'takeout', 'Walk-in', _tax_rate_ppm => ${RATE},
        _items => ${c.json([{ product_id: PRODUCT, quantity: 1, modifiers: [] }])}, _client_order_id => ${key()},
        _payment_method => 'cash') as id`.then((r) => r[0].id),
  );
  check(
    "V5 a POS sale (not a round) still cancels with its reversal",
    isUuid(posSale) &&
      (await as(U.MGR, (c) => voidRound(c, posSale))) === "ok" &&
      (
        await sql`select count(*)::int n from public.finance_entries where order_id = ${posSale} and kind like 'reversal_%'`
      )[0].n === 2,
  );

  // ---------------------------------------------------------------- M. move a round
  const S_4 = await as(U.CASH, (c) => open(c, T4));
  const C4a = await checkOf(S_4);
  const C4b = await as(U.CASH, (c) => openCheck(c, S_4, "Bia"));
  const R4 = await as(U.CASH, (c) => fire(c, C4a, 1));
  check(
    "M1 a round moves to another check of the same table",
    (await as(U.CASH, (c) => moveRound(c, R4, C4b))) === "ok" &&
      (await sql`select check_id from public.dining_check_rounds where order_id = ${R4}`)[0]
        .check_id === C4b,
  );
  const S_5 = await as(U.CASH, (c) => open(c, T5));
  const C5 = await checkOf(S_5);
  await refused("M2 not to a check of another table", "check_other_table", U.CASH, (c) =>
    moveRound(c, R4, C5),
  );
  await as(U.CASH, (c) => pay(c, C4b, "card", 100));
  await refused("M3 not once a tender is recorded", "check_has_payments", U.CASH, (c) =>
    moveRound(c, R4, C4a),
  );

  // ---------------------------------------------------------------- K. concurrency
  {
    // two payments for the whole balance at once
    const R5 = await as(U.CASH, (c) => fire(c, C5, 1)); // 428
    const first = await session(U.CASH);
    const second = await session(U.MGR);
    await first.c`begin`;
    const a = await pay(first.c, C5, "cash", 428).catch(code);
    const attempt = pay(second.c, C5, "card", 428).catch(code);
    const waited = await blockedBy(second.pid, first.pid);
    await first.c`commit`;
    const b = await attempt;
    const tenders = (
      await sql`select count(*)::int n from public.dining_check_payments where check_id = ${C5} and status = 'recorded'`
    )[0].n;
    check(
      "K1 two payments for the same balance: the second waits and is refused; one tender, revenue once",
      waited &&
        a?.check_status === "closed" &&
        /check_not_open|payment_exceeds_balance/.test(String(b)) &&
        tenders === 1 &&
        (await ledger([R5])).length === 2 &&
        (await allocations([R5])).length === 1,
      `${waited} ${JSON.stringify(a)} ${b}`,
    );
    await first.end();
    await second.end();
  }
  for (const order of ["pay first", "void first"]) {
    await as(
      U.MGR,
      (c) => c`select public.set_dining_table_status(${ORG}, ${S1}, ${T5}, 'available')`,
    );
    const sid = await as(U.CASH, (c) => open(c, T5));
    const cid = await checkOf(sid);
    const ra = await as(U.CASH, (c) => fire(c, cid, 1)); // 428
    await as(U.CASH, (c) => fire(c, cid, 1)); // 428, total 856
    const first = await session(order === "pay first" ? U.CASH : U.MGR);
    const second = await session(order === "pay first" ? U.MGR : U.CASH);
    await first.c`begin`;
    const r1 =
      order === "pay first"
        ? await pay(first.c, cid, "card", 856).catch(code)
        : await voidRound(first.c, ra).catch(code);
    const attempt =
      order === "pay first"
        ? voidRound(second.c, ra).catch(code)
        : pay(second.c, cid, "card", 856).catch(code);
    const waited = await blockedBy(second.pid, first.pid);
    await first.c`commit`;
    const r2 = await attempt;
    const [row] = await sql`select (select status from public.orders where id = ${ra}) as round,
        (select coalesce(sum(amount_cents), 0)::int from public.dining_check_payments where check_id = ${cid} and status = 'recorded') as paid,
        (select status from public.dining_checks where id = ${cid}) as chk`;
    const ok =
      order === "pay first"
        ? r1?.check_status === "closed" &&
          r2 === "check_has_payments" &&
          row.round !== "cancelled" &&
          row.paid === 856
        : r1 === "ok" &&
          r2 === "payment_exceeds_balance" &&
          row.round === "cancelled" &&
          row.paid === 0 &&
          row.chk === "open";
    check(
      `K2 ${order}: never a voided round on a paid check, never paid more than the check`,
      waited && ok,
      `${waited} ${JSON.stringify(r1)} ${r2} ${JSON.stringify(row)}`,
    );
    await first.end();
    await second.end();
    if (row.chk === "open") {
      await as(U.CASH, (c) => pay(c, cid, "cash", 428));
    }
  }
  const [{ dup }] =
    await sql`select count(*)::int as dup from (select order_id, kind from public.finance_entries
      where org_id = ${ORG} and kind in ('revenue','cogs') group by order_id, kind having count(*) > 1) x`;
  check("K3 across the whole run no order has revenue or COGS twice", dup === 0);
  const audit = new Set(
    (
      await sql`select action from public.audit_logs where org_id = ${ORG} and action like 'tables.%'`
    ).map((x) => x.action),
  );
  check(
    "K4 paid, closed, session closed, reversed and moved are audited",
    [
      "tables.check_paid",
      "tables.check_closed",
      "tables.session_closed",
      "tables.payment_reversed",
      "tables.round_moved",
    ].every((a) => audit.has(a)),
  );
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
console.log(`Dining room payments: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
