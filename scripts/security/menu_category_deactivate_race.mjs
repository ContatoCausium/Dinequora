// Concurrency of saving a menu product and DEACTIVATING its category through
// save_operational_menu(kind 'category', {"active": false}) (issue #18, migration 0028).
// LOCAL/CI QA stack ONLY.
//
// 0028 makes the deactivating category save lock the category FOR UPDATE and refuse with
// category_in_use while an active product uses it; the product save reads the category FOR SHARE
// (0027). Two PostgreSQL sessions run the two operations concurrently, in both orders, with COMMIT
// and ROLLBACK, plus the sequential case.
//
// REGRESSION tests (they FAIL without 0028: with the 0027 body the category save waits for the
// product save, then deactivates the category anyway):
//   0. sequential: deactivating a category that has an active product is refused (category_in_use),
//      the category keeps its name and stays active, and no audit row is written;
//   1. product save first, committed: the deactivation waits, then is refused (category_in_use);
//   5. invariants at the end: no active product in an inactive category, and the audit trail holds
//      exactly the committed operations.
// BEHAVIOR-PRESERVATION tests (they also pass with 0027; they prove 0028 keeps that behavior and
// adds no blocking or deadlock):
//   2. deactivation first, committed: the product save waits, then is refused (category_required);
//   3. product save first, rolled back: the deactivation waits, then deactivates the empty category;
//   4. deactivation first, rolled back: the product save waits, then saves into the active category;
//   5. no deadlock or lock timeout in any scenario.
// Every wait is proven with pg_blocking_pids, not inferred from timing. Sessions end with COMMIT as a
// real client would (an operation that wrongly went through stays in the database and is caught).
// Every session is registered; the finally block terminates the ones still open (only this test's
// own pids) before cleaning up, and the cleanup connection has a lock_timeout.
//
// Isolation: the test creates its OWN organization and store and two synthetic members (owner =
// category editor, manager with the store = product editor) directly in the database, works only
// there and removes all of it at the end. It can run next to tests that also work only in their own
// organizations, but NOT during step 2b of the security suite (database without any organization);
// the suite runs its steps one after another.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:55322/postgres node scripts/security/menu_category_deactivate_race.mjs
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

const OWNER = crypto.randomUUID();
const EDITOR = crypto.randomUUID();
const org = isolatedOrg("deact", {
  taxRatePpm: 62500,
  members: [
    { userId: OWNER, role: "owner" },
    { userId: EDITOR, role: "manager", store: true },
  ],
});
const ORG = org.orgId;
const STORE = org.locationId;
const CATEGORIES = ["d0", "d1", "d2", "d3", "d4"];

// lock_timeout on the verification and cleanup connections: if a lock were still held, they fail
// with an error instead of waiting forever.
const sql = postgres(DB_URL, { max: 4, onnotice: () => {}, connection: { lock_timeout: "30s" } });
const fixtures = postgres(DB_URL, {
  max: 1,
  onnotice: () => {},
  connection: { lock_timeout: "30s" },
});
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (e) => String(e?.message ?? e).split("\n")[0];
const outcomes = [];

/** Sessions opened by this test and not yet ended (closed by the finally block if a step fails). */
const openSessions = new Set();
/** Backend pids of every session this test ever opened (checked at the end: none alive, no lock). */
const allPids = [];
/** A dedicated connection impersonating one member, with explicit transactions. */
async function session(userId) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  const s = { c, pid: null, end: null };
  openSessions.add(s);
  s.end = async () => {
    openSessions.delete(s);
    await c.end({ timeout: 5 });
  };
  await c`select set_config('request.jwt.claim.sub', ${userId}, false)`;
  await c`set lock_timeout = '20s'`;
  await c`set role authenticated`;
  [{ pid: s.pid }] = await c`select pg_backend_pid() as pid`;
  allPids.push(s.pid);
  return s;
}
/** Terminates the backends of the sessions still open (only this test's own pids), then closes them. */
async function closeOpenSessions() {
  const left = [...openSessions];
  const pids = left.map((s) => s.pid).filter((p) => Number.isInteger(p));
  if (pids.length)
    await sql`select pg_terminate_backend(pid) from pg_stat_activity where pid = any(${pids}::int[])`;
  for (const s of left) {
    openSessions.delete(s);
    await s.c.end({ timeout: 1 }).catch(() => undefined);
  }
  return { sessions: left.length, terminated: pids.length };
}
const saveCategory = (s, id, active) =>
  s.c`select public.save_operational_menu(${ORG}, 'category', ${s.c.json({ id, name: `${id} (renamed)`, active })})`;
// The manager's products are sold at its own store (a manager cannot create all-stores products).
const saveProduct = (s, id, cat) =>
  s.c`select public.save_operational_menu(${ORG}, 'product', ${s.c.json({
    id,
    name: id,
    category: cat,
    priceCents: 300,
    prepTimeMinutes: 1,
    locationIds: [STORE],
    modifierGroups: [],
    active: true,
  })}) as id`;
/** Runs a statement and records how it ended ("ok" or the error message). */
const attempt = (label, p) =>
  p.then(
    () => {
      outcomes.push([label, "ok"]);
      return "ok";
    },
    (e) => {
      outcomes.push([label, code(e)]);
      return code(e);
    },
  );
const category = async (id) =>
  (
    await sql`select active, name from public.menu_categories where org_id = ${ORG} and client_id = ${id}`
  )[0];
const product = async (id) =>
  (
    await sql`select p.active, c.client_id as category from public.menu_products p
                join public.menu_categories c on c.id = p.category_id
               where p.org_id = ${ORG} and p.client_id = ${id}`
  )[0];
/** menu.saved audit rows of one category (the audit target is the category id). */
const categorySaves = async (id) =>
  Number(
    (
      await sql`select count(*)::int as n from public.audit_logs a
                  join public.menu_categories c on a.target = c.id::text
                 where a.org_id = ${ORG} and c.org_id = ${ORG} and c.client_id = ${id}
                   and a.action = 'menu.saved' and a.metadata->>'kind' = 'category'`
    )[0].n,
  );
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
/** Resolves to "pending" if the promise has not settled within `ms` (used only after a proven wait). */
const settled = (p, ms) =>
  Promise.race([p.then(() => "resolved"), sleep(ms).then(() => "pending")]);

try {
  // ---- setup: users, organization, store, members, categories (all owned by this test)
  await fixtures.unsafe(
    createTestUsersSql([
      { userId: OWNER, email: `${org.key}-owner@example.test` },
      { userId: EDITOR, email: `${org.key}-manager@example.test` },
    ]),
  );
  await fixtures.unsafe(createIsolatedOrgSql(org));
  {
    const owner = await session(OWNER);
    for (const id of CATEGORIES)
      await owner.c`select public.save_operational_menu(${ORG}, 'category', ${owner.c.json({ id, name: id })})`;
    await owner.end();
    const editor = await session(EDITOR);
    await saveProduct(editor, "p0", "d0"); // an active product for the sequential case
    await editor.end();
  }
  const [{ active, total }] =
    await sql`select count(*) filter (where active)::int as active, count(*)::int as total
                from public.menu_categories where org_id = ${ORG}`;
  check(
    "fixture: exactly 5 categories, all active; product p0 active in d0",
    total === 5 && active === 5 && (await product("p0"))?.active === true,
    `${active}/${total} active`,
  );

  // ---- 0. sequential: deactivating a category in use is refused, nothing written
  {
    const owner = await session(OWNER);
    const outcome = await attempt("0 deactivate", saveCategory(owner, "d0", false));
    check(
      "0. deactivating a category with an active product is refused with category_in_use",
      outcome === "category_in_use",
      outcome,
    );
    const c = await category("d0");
    check(
      "0. the category keeps its name, stays active, and the refused save is not audited",
      c?.active === true && c.name === "d0" && (await categorySaves("d0")) === 1,
      JSON.stringify(c),
    );
    await owner.end();
  }

  // ---- 1. product save first, committed: the deactivation waits, then is refused
  {
    const editor = await session(EDITOR);
    const owner = await session(OWNER);
    await editor.c`begin`;
    await saveProduct(editor, "p1", "d1"); // category read FOR SHARE, transaction still open
    await owner.c`begin`;
    const deact = attempt("1 deactivate", saveCategory(owner, "d1", false));
    check(
      "1. the deactivation waits for the open product save (blocked on the category row)",
      await blockedBy(owner.pid, editor.pid),
    );
    check(
      "1. the deactivation is still waiting after 1.5 s",
      (await settled(deact, 1500)) === "pending",
    );
    await editor.c`commit`;
    const outcome = await deact;
    check(
      "1. once the product save commits, the deactivation is refused with category_in_use",
      outcome === "category_in_use",
      outcome,
    );
    await owner.c`commit`; // as a real client would: a wrongly accepted deactivation is persisted and caught
    const c = await category("d1");
    const p = await product("p1");
    check(
      "1. the category stays active (not renamed) and the product is active in it",
      c?.active === true && c.name === "d1" && p?.active === true && p.category === "d1",
      JSON.stringify({ c, p }),
    );
    await editor.end();
    await owner.end();
  }

  // ---- 2. deactivation first, committed: the product save waits, then is refused
  {
    const owner = await session(OWNER);
    const editor = await session(EDITOR);
    await owner.c`begin`;
    await saveCategory(owner, "d2", false); // category locked and deactivated, not committed
    await editor.c`begin`;
    const save = attempt("2 save", saveProduct(editor, "p2", "d2"));
    check(
      "2. the product save waits for the deactivation in progress",
      await blockedBy(editor.pid, owner.pid),
    );
    await owner.c`commit`;
    const outcome = await save;
    check(
      "2. once the deactivation commits, the product save is refused with category_required",
      outcome === "category_required",
      outcome,
    );
    await editor.c`commit`; // as a real client would (see scenario 1)
    check(
      "2. the category is inactive and the product does not exist",
      (await category("d2"))?.active === false && (await product("p2")) === undefined,
    );
    await editor.end();
    await owner.end();
  }

  // ---- 3. product save first, rolled back: the deactivation waits, then deactivates
  {
    const editor = await session(EDITOR);
    const owner = await session(OWNER);
    await editor.c`begin`;
    await saveProduct(editor, "p3", "d3");
    await owner.c`begin`;
    const deact = attempt("3 deactivate", saveCategory(owner, "d3", false));
    check(
      "3. the deactivation waits for the open product save",
      await blockedBy(owner.pid, editor.pid),
    );
    await editor.c`rollback`;
    check("3. once the product save rolls back, the deactivation succeeds", (await deact) === "ok");
    await owner.c`commit`;
    check(
      "3. the category is inactive and the rolled-back product does not exist",
      (await category("d3"))?.active === false && (await product("p3")) === undefined,
    );
    await editor.end();
    await owner.end();
  }

  // ---- 4. deactivation first, rolled back: the product save waits, then saves
  {
    const owner = await session(OWNER);
    const editor = await session(EDITOR);
    await owner.c`begin`;
    await saveCategory(owner, "d4", false);
    await editor.c`begin`;
    const save = attempt("4 save", saveProduct(editor, "p4", "d4"));
    check(
      "4. the product save waits for the deactivation in progress",
      await blockedBy(editor.pid, owner.pid),
    );
    await owner.c`rollback`;
    check("4. once the deactivation rolls back, the product save succeeds", (await save) === "ok");
    await editor.c`commit`;
    const p = await product("p4");
    check(
      "4. the category is still active and the product is active in it",
      (await category("d4"))?.active === true && p?.active === true && p.category === "d4",
      JSON.stringify(p),
    );
    await editor.end();
    await owner.end();
  }

  // ---- 5. invariants
  {
    const [{ n }] =
      await sql`select count(*)::int as n from public.menu_products p join public.menu_categories c on c.id = p.category_id
                 where p.org_id = ${ORG} and p.active and not c.active`;
    check("5. no active product in an inactive category", n === 0, `${n} found`);
    const deadlocks = outcomes.filter(([, o]) =>
      /deadlock|lock timeout|canceling statement/i.test(o),
    );
    check(
      "5. no deadlock or lock timeout in any scenario",
      deadlocks.length === 0,
      JSON.stringify(deadlocks),
    );
    // setup saved each category once; the committed deactivations are d2 and d3 only
    const saves = [];
    for (const id of CATEGORIES) saves.push(`${id}:${await categorySaves(id)}`);
    check(
      "5. exactly the committed category saves are audited (setup once each, plus d2 and d3)",
      saves.join(",") === "d0:1,d1:1,d2:2,d3:2,d4:1",
      saves.join(","),
    );
    const productSaves = Number(
      (
        await sql`select count(*)::int as n from public.audit_logs
                   where org_id = ${ORG} and action = 'menu.saved' and metadata->>'kind' = 'product'`
      )[0].n,
    );
    // p0 (setup), p1, p4: the refused or rolled-back product saves (p2, p3) leave no row
    check(
      "5. exactly the committed product saves are audited (3)",
      productSaves === 3,
      String(productSaves),
    );
  }
} catch (e) {
  // An intermediate failure is reported as a failed check (the summary still prints, exit code 1).
  check("test aborted before its end", false, code(e));
} finally {
  // 1. Sessions still open (only after a failure): terminate their backends, then close them.
  try {
    const closed = await closeOpenSessions();
    let alive = -1;
    let held = -1;
    for (let i = 0; i < 40; i++) {
      [{ alive }] =
        await sql`select count(*)::int as alive from pg_stat_activity where pid = any(${allPids}::int[])`;
      [{ held }] =
        await sql`select count(*)::int as held from pg_locks where pid = any(${allPids}::int[])`;
      if (alive === 0 && held === 0) break;
      await sleep(50);
    }
    check(
      `cleanup: none of the ${allPids.length} sessions of this test is alive or holds a lock`,
      alive === 0 && held === 0,
      `${closed.sessions} were still open at the end (terminated ${closed.terminated}); ${alive} alive, ${held} locks`,
    );
  } catch (e) {
    check("cleanup: sessions of this test closed", false, code(e));
  }
  // 2. Remove the organization, its rows and the two synthetic users; nothing else is touched.
  try {
    await fixtures.unsafe(dropIsolatedOrgsSql([ORG]));
    await fixtures.unsafe(dropTestUsersSql([OWNER, EDITOR]));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([ORG]).replace(/;\s*$/, "")}) x(n)`,
    );
    const [{ u }] =
      await sql`select count(*)::int as u from auth.users where id in (${OWNER}, ${EDITOR})`;
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
  `Menu category deactivation race: ${results.length - failed.length}/${results.length} passed`,
);
if (failed.length) process.exit(1);
