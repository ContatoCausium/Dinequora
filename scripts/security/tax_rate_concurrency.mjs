// Concurrency of a sale and a store sales-tax rate change (migration 0025). LOCAL/CI QA stack ONLY.
//
// create_pos_sale_v2 reads locations.tax_rate_ppm FOR SHARE; set_location_tax_rate locks the row FOR
// UPDATE before changing it. Two PostgreSQL sessions prove that the two operations are serialized:
//   1. a sale that already read the rate holds the row: the rate change waits until the sale's
//      transaction ends, and the sale is recorded with the rate it validated;
//   2. a rate change in progress holds the row: a sale arriving meanwhile waits, then reads the
//      committed rate; a confirmation of the previous rate is refused (tax_rate_changed) and a
//      confirmation of the new rate is recorded with the new rate;
//   3. a rate change that rolls back leaves the previous rate: a sale confirming the new rate is
//      refused, nothing is recorded;
//   4. two sales at the same store never wait for each other on the store row (FOR SHARE is shared);
//   5. every order recorded by this test carries the rate the server validated and a tax equal to
//      round(taxable x ppm / 1,000,000); the audit trail holds each committed change exactly once,
//      by the member who made it, and nothing of the rolled-back one.
//
// Isolation: the test creates its OWN organization, store (88,750 ppm), product and two synthetic
// members (owner = seller, manager with settings.locations at the store = changer) directly in the
// database, works only there and removes all of it at the end. It does not read or change the
// shared QA tenant and can run in parallel with every other test.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:55322/postgres node scripts/security/tax_rate_concurrency.mjs
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
const require = createRequire(new URL("../../package.json", import.meta.url));
const postgres = require("postgres");

const DB_URL = process.env.QA_DB_URL ?? process.env.DB_URL;
if (!/@(127\.0\.0\.1|localhost):55322\/postgres$/.test(DB_URL ?? ""))
  throw new Error("Refusing: QA_DB_URL must be the local QA database (55322)");

const SEEDED = 88750;
const PRODUCT = "conc-soda";
const SELLER = crypto.randomUUID();
const CHANGER = crypto.randomUUID();
const org = isolatedOrg("conc", {
  taxRatePpm: SEEDED,
  members: [
    { userId: SELLER, role: "owner" },
    { userId: CHANGER, role: "manager", store: true },
  ],
});
const ORG = org.orgId;
const STORE = org.locationId;

const sql = postgres(DB_URL, { max: 4, onnotice: () => {} });
// Fixture SQL (multi-statement, own transaction) needs a single dedicated connection.
const fixtures = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (e) => String(e?.message ?? e).split("\n")[0];

/**
 * A dedicated connection impersonating one member (its own pool of one, so the role and claim never
 * leak into the admin pool used for verification), with explicit transactions; `end()` closes it.
 */
async function session(userId) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  await c`select set_config('request.jwt.claim.sub', ${userId}, false)`;
  await c`set lock_timeout = '20s'`;
  await c`set role authenticated`;
  const [{ pid }] = await c`select pg_backend_pid() as pid`;
  return { c, pid, end: () => c.end({ timeout: 5 }) };
}
const items = (c) => c.json([{ product_id: PRODUCT, quantity: 1, modifiers: [] }]);
const sale = (s, cid, ppm) =>
  s.c`select public.persist_finalized_pos_sale_atomic_v2(${ORG}, ${STORE}, 'takeout', 'Concurrency test',
        _tax_rate_ppm => ${ppm}, _items => ${items(s.c)},
        _client_order_id => ${cid}, _payment_method => 'cash') as id`.then((r) => r[0].id);
const setRate = (s, ppm) => s.c`select public.set_location_tax_rate(${STORE}, ${ppm})`;
const rate = async () =>
  (await sql`select tax_rate_ppm from public.locations where id = ${STORE}`)[0].tax_rate_ppm;
const order = async (cid) =>
  (
    await sql`select id, subtotal_cents, discount_cents, tax_cents, total_cents, tax_rate_ppm, tax_rate_basis_points
              from public.orders where org_id = ${ORG} and client_order_id = ${cid}`
  )[0];
/** Waits until `pid` is blocked by `byPid` on a lock (or gives up after 10 s). */
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
/** Resolves to "pending" if the promise has not settled within `ms`. */
const settled = (p, ms) =>
  Promise.race([
    p.then(
      () => "resolved",
      () => "rejected",
    ),
    sleep(ms).then(() => "pending"),
  ]);
/** Rate audit rows of THIS store, oldest first. */
const rateAudits = () =>
  sql`select actor_id::text as actor, (metadata->>'from_ppm')::int as f, (metadata->>'to_ppm')::int as t
        from public.audit_logs
       where org_id = ${ORG} and action = 'location.tax_rate_updated' and metadata->>'location_id' = ${STORE}
       order by created_at, id`;

try {
  // ---- setup: users, organization, store, members, product (all owned by this test)
  await fixtures.unsafe(
    createTestUsersSql([
      { userId: SELLER, email: `${org.key}-owner@example.test` },
      { userId: CHANGER, email: `${org.key}-manager@example.test` },
    ]),
  );
  await fixtures.unsafe(createIsolatedOrgSql(org));
  {
    const owner = await session(SELLER);
    await owner.c`select public.save_operational_menu(${ORG}, 'category', ${owner.c.json({ id: "conc-drinks", name: "Drinks" })})`;
    await owner.c`select public.save_operational_menu(${ORG}, 'product', ${owner.c.json({ id: PRODUCT, name: "Concurrency soda", category: "conc-drinks", priceCents: 275, prepTimeMinutes: 1, locationIds: [], modifierGroups: [] })})`;
    await owner.end();
  }
  const [{ perms }] =
    await sql`select 'settings.locations' = any(effective_permissions) as perms from public.organization_members where org_id = ${ORG} and user_id = ${CHANGER}`;
  check(
    "fixture: isolated store at 88,750 ppm, manager holds settings.locations",
    (await rate()) === SEEDED && perms === true,
  );

  // ---- 1. sale first, then the rate change waits for it
  {
    const seller = await session(SELLER);
    const changer = await session(CHANGER);
    await seller.c`begin`;
    const cid = `${org.key}-sale-first`;
    const id = await sale(seller, cid, SEEDED); // rate read FOR SHARE, transaction still open
    await changer.c`begin`;
    const change = setRate(changer, 70000).then(
      () => "ok",
      (e) => code(e),
    ); // must wait
    check(
      "1. the rate change waits for the open sale (blocked on the store row)",
      await blockedBy(changer.pid, seller.pid),
    );
    check(
      "1. the rate change is still waiting after 1.5 s",
      (await settled(change, 1500)) === "pending",
    );
    await seller.c`commit`;
    check("1. the rate change proceeds once the sale commits", (await change) === "ok");
    await changer.c`commit`;
    const o = await order(cid);
    check(
      "1. the sale was recorded with the rate it validated (88,750), not the new one",
      o?.id === id &&
        o.tax_rate_ppm === SEEDED &&
        o.tax_cents === Math.round((o.subtotal_cents * SEEDED) / 1e6),
      JSON.stringify(o),
    );
    check("1. the new rate is in force after the change", (await rate()) === 70000);
    const a = await rateAudits();
    check(
      "1. the committed change is audited exactly once, by the manager (88,750 -> 70,000)",
      a.length === 1 && a[0].actor === CHANGER && a[0].f === SEEDED && a[0].t === 70000,
      JSON.stringify(a),
    );
    await seller.end();
    await changer.end();
  }

  // ---- 2. rate change first, then a sale waits and reads the committed rate
  {
    const changer = await session(CHANGER);
    const seller = await session(SELLER);
    await changer.c`begin`;
    await setRate(changer, 90250); // FOR UPDATE held, not committed
    await seller.c`begin`;
    const cid = `${org.key}-change-first`;
    const attempt = sale(seller, cid, 70000).then(
      () => "ok",
      (e) => code(e),
    ); // confirms the rate it displayed
    check(
      "2. the sale waits for the rate change in progress (blocked on the store row)",
      await blockedBy(seller.pid, changer.pid),
    );
    check("2. the sale is still waiting after 1.5 s", (await settled(attempt, 1500)) === "pending");
    await changer.c`commit`;
    const outcome = await attempt;
    check(
      "2. after the commit the sale confirming the previous rate is refused",
      outcome === "tax_rate_changed",
      outcome,
    );
    await seller.c`rollback`;
    check("2. nothing was recorded for the refused sale", (await order(cid)) === undefined);
    await seller.c`begin`;
    const cid2 = `${org.key}-change-first-new`;
    const id2 = await sale(seller, cid2, 90250);
    await seller.c`commit`;
    const o = await order(cid2);
    check(
      "2. a sale confirming the new rate is recorded with the new rate",
      o?.id === id2 &&
        o.tax_rate_ppm === 90250 &&
        o.tax_rate_basis_points === 903 &&
        o.tax_cents === Math.round((o.subtotal_cents * 90250) / 1e6),
      JSON.stringify(o),
    );
    const a = await rateAudits();
    check(
      "2. the second committed change is audited exactly once, by the manager (70,000 -> 90,250)",
      a.length === 2 && a[1].actor === CHANGER && a[1].f === 70000 && a[1].t === 90250,
      JSON.stringify(a),
    );
    await changer.end();
    await seller.end();
  }

  // ---- 3. a rate change that rolls back: the sale that waited reads the previous rate
  {
    const changer = await session(CHANGER);
    const seller = await session(SELLER);
    await changer.c`begin`;
    await setRate(changer, 50000);
    await seller.c`begin`;
    const cid = `${org.key}-rollback`;
    const attempt = sale(seller, cid, 50000).then(
      () => "ok",
      (e) => code(e),
    );
    check("3. the sale waits for the uncommitted change", await blockedBy(seller.pid, changer.pid));
    await changer.c`rollback`;
    const outcome = await attempt;
    check(
      "3. after the rollback the sale confirming the abandoned rate is refused",
      outcome === "tax_rate_changed",
      outcome,
    );
    await seller.c`rollback`;
    check(
      "3. nothing was recorded and the rate is unchanged",
      (await order(cid)) === undefined && (await rate()) === 90250,
    );
    const a = await rateAudits();
    check(
      "3. the rolled-back change left no audit row (still exactly the two committed ones)",
      a.length === 2 && !a.some((r) => r.t === 50000),
      JSON.stringify(a),
    );
    await changer.end();
    await seller.end();
  }

  // ---- 4. two sales at the same store do not wait for each other on the store row. Session A
  //         opens a ticket (create_pos_sale_v2: store row FOR SHARE, no stock lock) and keeps its
  //         transaction open; session B records a full sale meanwhile. (Two FULL sales of the same
  //         recipe product do serialize on the stock row FOR UPDATE, by design, unrelated to 0025.)
  {
    const a = await session(SELLER);
    const b = await session(SELLER);
    await a.c`begin`;
    const cidA = `${org.key}-parallel-a`;
    await a.c`select public.create_pos_sale_v2(${ORG}, ${STORE}, 'takeout', 'Concurrency test',
        _tax_rate_ppm => ${90250}, _items => ${items(a.c)},
        _client_order_id => ${cidA})`; // holds the store row FOR SHARE until the transaction ends
    await b.c`begin`;
    const cidB = `${org.key}-parallel-b`;
    const second = sale(b, cidB, 90250).then(
      () => "ok",
      (e) => code(e),
    );
    check(
      "4. a second sale completes while the first ticket is still open (FOR SHARE is shared)",
      (await settled(second, 5000)) === "resolved",
    );
    await b.c`commit`;
    await a.c`rollback`; // the open ticket of A is discarded: nothing left behind
    check(
      "4. the second sale is recorded at the store rate; the discarded ticket is not",
      (await order(cidB))?.tax_rate_ppm === 90250 && (await order(cidA)) === undefined,
    );
    await a.end();
    await b.end();
  }

  // ---- 5. invariants over everything this test recorded (the organization is its own)
  {
    const rows =
      await sql`select client_order_id, subtotal_cents, discount_cents, tax_cents, tax_rate_ppm, tax_rate_basis_points
                  from public.orders where org_id = ${ORG} order by client_order_id`;
    const bad = rows.filter(
      (o) =>
        ![SEEDED, 90250].includes(o.tax_rate_ppm) ||
        o.tax_cents !==
          Math.round(((o.subtotal_cents - o.discount_cents) * o.tax_rate_ppm) / 1e6) ||
        o.tax_rate_basis_points !== Math.round(o.tax_rate_ppm / 100),
    );
    check(
      `5. the organization holds exactly the 3 recorded sales, each at a validated rate with its tax`,
      rows.length === 3 && bad.length === 0,
      rows.map((r) => r.client_order_id.replace(`${org.key}-`, "")).join(","),
    );
    const a = await rateAudits();
    check(
      "5. audit trail of the store: exactly [88,750 -> 70,000, 70,000 -> 90,250], both by the manager",
      JSON.stringify(a.map((r) => [r.actor === CHANGER, r.f, r.t])) ===
        JSON.stringify([
          [true, SEEDED, 70000],
          [true, 70000, 90250],
        ]),
      JSON.stringify(a),
    );
  }
} finally {
  // Remove the organization, its rows and the two synthetic users; nothing else is touched.
  try {
    await fixtures.unsafe(dropIsolatedOrgsSql([ORG]));
    await fixtures.unsafe(dropTestUsersSql([SELLER, CHANGER]));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([ORG]).replace(/;\s*$/, "")}) x(n)`,
    );
    const [{ u }] =
      await sql`select count(*)::int as u from auth.users where id in (${SELLER}, ${CHANGER})`;
    check(
      "cleanup: nothing of the isolated organization or its users is left",
      Number(n) === 0 && u === 0,
      `${n} rows, ${u} users`,
    );
  } catch (e) {
    check("cleanup: isolated organization removed", false, code(e));
  }
  await sql.end({ timeout: 5 });
  await fixtures.end({ timeout: 5 });
}

const failed = results.filter((r) => !r.ok);
console.log(`Tax rate concurrency: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
