// Concurrency of a POS sale and the manual resolution of a pending sale (migration 0032).
// LOCAL/CI QA stack ONLY.
//
// create_pos_sale_v2 and resolve_pending_pos_sale take the SAME transaction-level advisory lock,
// pg_advisory_xact_lock(hashtextextended(org_id || ':' || trim(key), 0)). Two real PostgreSQL
// sessions prove, in BOTH orders, that the two operations are serialized on the key:
//   1. sale first (open transaction), resolution waits on the lock (pg_blocking_pids);
//      sale COMMIT → the resolution finds the order: "recorded", nothing closed, 1 order;
//   2. sale first, sale ROLLBACK → the resolution finds no order: "resolved", key closed; a new
//      attempt of the same sale is then refused (sale_key_voided), 0 orders;
//   3. resolution first (open transaction), the sale waits on the lock;
//      resolution COMMIT → the sale is refused (sale_key_voided), 0 orders, 1 closed key;
//   4. resolution first, resolution ROLLBACK → the sale proceeds and is recorded (1 order, no
//      closed key, no audit of the rolled-back resolution); resolving afterwards → "recorded".
// Audit: exactly one 'pos.pending_sale_resolved' per committed closure, by the resolver; nothing
// of the rolled-back one.
//
// Isolation: own organization, store, product and two synthetic members (owner = seller,
// owner = resolver), all removed at the end.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/pos_pending_resolution_race.mjs
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
await assertDisposableDb(DB_URL, "test:pos-pending-resolution-race").catch(exitOnRefusal);

const RATE = 88750;
const PRODUCT = "race-soda";
const SELLER = crypto.randomUUID();
const RESOLVER = crypto.randomUUID();
const org = isolatedOrg("pendrace", {
  taxRatePpm: RATE,
  members: [
    { userId: SELLER, role: "owner" },
    { userId: RESOLVER, role: "owner" },
  ],
});
const ORG = org.orgId;
const STORE = org.locationId;

const sql = postgres(DB_URL, { max: 4, onnotice: () => {} });
const fixtures = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (e) => String(e?.message ?? e).split("\n")[0];

/** A dedicated connection impersonating one member, explicit transactions; `end()` closes it. */
async function session(userId) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  await c`select set_config('request.jwt.claim.sub', ${userId}, false)`;
  await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, false)`;
  await c`set lock_timeout = '20s'`;
  await c`set role authenticated`;
  const [{ pid }] = await c`select pg_backend_pid() as pid`;
  return { c, pid, end: () => c.end({ timeout: 5 }) };
}
const sale = (s, key) =>
  s.c`select public.persist_finalized_pos_sale_atomic_v2(${ORG}, ${STORE}, 'takeout', 'Race test',
        _tax_rate_ppm => ${RATE}, _items => ${s.c.json([{ product_id: PRODUCT, quantity: 1, modifiers: [] }])},
        _client_order_id => ${key}, _payment_method => 'cash') as id`.then((r) => r[0].id);
const resolve = (s, key) =>
  s.c`select public.resolve_pending_pos_sale(${ORG}, ${STORE}, ${key}, 'Race test: customer left without paying') as r`.then(
    (r) => r[0].r,
  );
const orders = async (key) =>
  (
    await sql`select count(*)::int c from public.orders where org_id = ${ORG} and client_order_id = ${key}`
  )[0].c;
const voids = async (key) =>
  (
    await sql`select count(*)::int c from public.pos_sale_key_voids where org_id = ${ORG} and client_order_id = ${key}`
  )[0].c;
const audits = async (key) =>
  sql`select action, actor_id::text as actor from public.audit_logs
       where org_id = ${ORG} and target = ${key} and action like 'pos.pending_sale_%' order by created_at, id`;
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
const settled = (p, ms) =>
  Promise.race([
    p.then(
      () => "resolved",
      () => "rejected",
    ),
    sleep(ms).then(() => "pending"),
  ]);

try {
  // ---- setup
  await fixtures.unsafe(
    createTestUsersSql([
      { userId: SELLER, email: `${org.key}-seller@example.test` },
      { userId: RESOLVER, email: `${org.key}-resolver@example.test` },
    ]),
  );
  await fixtures.unsafe(createIsolatedOrgSql(org));
  {
    const owner = await session(SELLER);
    await owner.c`select public.save_operational_menu(${ORG}, 'category', ${owner.c.json({ op: "create", id: "race-drinks", name: "Drinks" })})`;
    await owner.c`select public.save_operational_menu(${ORG}, 'product', ${owner.c.json({ id: PRODUCT, name: "Race soda", category: "race-drinks", priceCents: 275, prepTimeMinutes: 1, locationIds: [], modifierGroups: [] })})`;
    await owner.end();
  }
  check("fixture: isolated store and product ready", true);

  // ---- 1. sale first (COMMIT): the resolution waits, then finds the order
  {
    const key = `${org.key}-1`;
    const seller = await session(SELLER);
    const resolver = await session(RESOLVER);
    await seller.c`begin`;
    const id = await sale(seller, key); // lock held, not committed
    await resolver.c`begin`;
    const res = resolve(resolver, key);
    check(
      "1. the resolution waits for the sale (blocked on the key's advisory lock)",
      await blockedBy(resolver.pid, seller.pid),
    );
    check("1. still waiting after 1.5 s", (await settled(res, 1500)) === "pending");
    await seller.c`commit`;
    const r = await res;
    await resolver.c`commit`;
    check(
      "1. after the sale commits, the resolution returns the order: recorded",
      r?.status === "recorded" && r.order_id === id,
      JSON.stringify(r),
    );
    check(
      "1. nothing was closed; exactly one order",
      (await voids(key)) === 0 && (await orders(key)) === 1,
    );
    const a = await audits(key);
    check(
      "1. audited as recovered, by the resolver",
      a.length === 1 && a[0].action === "pos.pending_sale_recovered" && a[0].actor === RESOLVER,
      JSON.stringify(a),
    );
    await seller.end();
    await resolver.end();
  }

  // ---- 2. sale first (ROLLBACK): the resolution waits, then closes the key
  {
    const key = `${org.key}-2`;
    const seller = await session(SELLER);
    const resolver = await session(RESOLVER);
    await seller.c`begin`;
    await sale(seller, key);
    await resolver.c`begin`;
    const res = resolve(resolver, key);
    check(
      "2. the resolution waits for the sale (blocked on the key's advisory lock)",
      await blockedBy(resolver.pid, seller.pid),
    );
    await seller.c`rollback`;
    const r = await res;
    await resolver.c`commit`;
    check(
      "2. after the sale rolls back, the resolution closes the key: resolved",
      r?.status === "resolved",
      JSON.stringify(r),
    );
    const again = await sale(seller, key).then(
      () => "recorded",
      (e) => code(e),
    );
    check(
      "2. a new attempt of that sale is refused (sale_key_voided), 0 orders",
      again === "sale_key_voided" && (await orders(key)) === 0,
      again,
    );
    const a = await audits(key);
    check(
      "2. one closure, audited once, by the resolver",
      (await voids(key)) === 1 &&
        a.length === 1 &&
        a[0].action === "pos.pending_sale_resolved" &&
        a[0].actor === RESOLVER,
      JSON.stringify(a),
    );
    await seller.end();
    await resolver.end();
  }

  // ---- 3. resolution first (COMMIT): the sale waits, then is refused
  {
    const key = `${org.key}-3`;
    const seller = await session(SELLER);
    const resolver = await session(RESOLVER);
    await resolver.c`begin`;
    const r = await resolve(resolver, key); // lock held, closure not committed
    await seller.c`begin`;
    const attempt = sale(seller, key).then(
      () => "recorded",
      (e) => code(e),
    );
    check(
      "3. the sale waits for the resolution (blocked on the key's advisory lock)",
      await blockedBy(seller.pid, resolver.pid),
    );
    check("3. still waiting after 1.5 s", (await settled(attempt, 1500)) === "pending");
    await resolver.c`commit`;
    const outcome = await attempt;
    await seller.c`rollback`;
    check(
      "3. the resolution had found no order: resolved",
      r?.status === "resolved",
      JSON.stringify(r),
    );
    check(
      "3. after the closure commits, the sale is refused (sale_key_voided)",
      outcome === "sale_key_voided",
      outcome,
    );
    check(
      "3. 0 orders, 1 closed key, audited once",
      (await orders(key)) === 0 && (await voids(key)) === 1 && (await audits(key)).length === 1,
    );
    await seller.end();
    await resolver.end();
  }

  // ---- 4. resolution first (ROLLBACK): the sale waits, then is recorded
  {
    const key = `${org.key}-4`;
    const seller = await session(SELLER);
    const resolver = await session(RESOLVER);
    await resolver.c`begin`;
    await resolve(resolver, key);
    await seller.c`begin`;
    const attempt = sale(seller, key).then(
      (id) => id,
      (e) => code(e),
    );
    check(
      "4. the sale waits for the resolution (blocked on the key's advisory lock)",
      await blockedBy(seller.pid, resolver.pid),
    );
    await resolver.c`rollback`;
    const id = await attempt;
    await seller.c`commit`;
    check(
      "4. after the closure rolls back, the sale is recorded",
      typeof id === "string" && id.length === 36 && (await orders(key)) === 1,
      String(id),
    );
    check(
      "4. no closed key and no audit of the rolled-back closure",
      (await voids(key)) === 0 && (await audits(key)).length === 0,
    );
    const after = await resolve(resolver, key);
    check(
      "4. resolving afterwards returns the recorded order, closes nothing",
      after?.status === "recorded" && after.order_id === id && (await voids(key)) === 0,
      JSON.stringify(after),
    );
    await seller.end();
    await resolver.end();
  }
} finally {
  try {
    await fixtures.unsafe(dropIsolatedOrgsSql([ORG]));
    await fixtures.unsafe(dropTestUsersSql([SELLER, RESOLVER]));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([ORG]).replace(/;\s*$/, "")}) x(n)`,
    );
    const [{ u }] =
      await sql`select count(*)::int as u from auth.users where id in (${SELLER}, ${RESOLVER})`;
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
console.log(
  `POS pending-sale resolution race: ${results.length - failed.length}/${results.length} passed`,
);
if (failed.length) process.exit(1);
