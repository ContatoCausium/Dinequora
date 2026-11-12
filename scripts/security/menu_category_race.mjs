// Concurrency of saving a menu product and archiving its category (issue #15, migration 0027).
// LOCAL/CI QA stack ONLY.
//
// save_operational_menu reads the product's category FOR SHARE (0027); archive_operational_menu
// locks the category FOR UPDATE before checking that no active product uses it (0026). Two
// PostgreSQL sessions run the two operations concurrently, in both orders, with COMMIT and ROLLBACK.
//
// REGRESSION tests (they FAIL without the 0027 lock: with the 0018 body the save does not wait at
// its category read, only at its foreign-key check, and then goes through):
//   2. archive first, committed: the save waits for the archive, then refuses (category_required);
//   6. an EXISTING product moved into a category being archived: the move waits, then refuses, and
//      the product stays active in its original category;
//   7. invariants at the end: no active product in an archived category, and the audit trail holds
//      exactly the committed operations (with 0018: 2 active products in archived categories and 7
//      product saves audited instead of 5).
// BEHAVIOR-PRESERVATION tests (they also pass with 0018, where the archive already waited on the
// save's foreign-key lock; they prove 0027 keeps that behavior and adds no blocking or deadlock):
//   1. save first, committed: the archive waits for the save, then refuses (category_in_use);
//   3. save first, rolled back: the archive waits, then archives the (still empty) category;
//   4. archive first, rolled back: the save waits, then saves the product into the active category;
//   5. two saves into the same category never wait for each other (FOR SHARE is shared): proven by
//      pg_blocking_pids, never by a time window;
//   7. no deadlock or lock timeout in any scenario.
// Every wait is proven with pg_blocking_pids, not inferred from timing.
//
// Sessions end with COMMIT as a real client would (a save that wrongly went through stays in the
// database and is caught). Every session is registered; the finally block terminates the ones still
// open (pg_terminate_backend on their own pids only) before cleaning up, so an intermediate failure
// never leaves a transaction or a lock behind, and the cleanup connection has a lock_timeout.
// RACE_TEST_FAULT=after-lock injects a failure while two sessions hold and wait for locks (used to
// test this cleanup; never set in the suite).
//
// Isolation: the test creates its OWN organization and store and two synthetic members (owner =
// archiver, manager with the store = product editor) directly in the database, works only there and
// removes all of it at the end. It does not read or change the shared QA tenant or any other
// organization, so it can run next to tests that also work only in their own organizations (the
// tax-rate concurrency test, the database tests of step 7). It must NOT run during step 2b of the
// security suite, which requires a database with no organization at all; the suite runs its steps
// one after another, so this does not happen there.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:55322/postgres node scripts/security/menu_category_race.mjs
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
const org = isolatedOrg("race", {
  taxRatePpm: 62500,
  members: [
    { userId: OWNER, role: "owner" },
    { userId: EDITOR, role: "manager", store: true },
  ],
});
const ORG = org.orgId;
const STORE = org.locationId;

// lock_timeout on the verification and cleanup connections: if a lock were still held, they fail
// with an error instead of waiting forever.
const sql = postgres(DB_URL, { max: 4, onnotice: () => {}, connection: { lock_timeout: "30s" } });
// Fixture SQL (multi-statement, own transaction) needs a single dedicated connection.
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
/**
 * Ends every session still open: their backends are terminated first (this rolls back their
 * transactions and releases their locks even if a statement is still waiting), then the client
 * connections are closed. Only the pids of this test's own sessions are touched.
 */
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
const category = (s, id) =>
  s.c`select public.save_operational_menu(${ORG}, 'category', ${s.c.json({ op: "create", id, name: id })})`;
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
const archive = (s, id) => s.c`select public.archive_operational_menu(${ORG}, 'category', ${id})`;
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
const catActive = async (id) =>
  (
    await sql`select active from public.menu_categories where org_id = ${ORG} and client_id = ${id}`
  )[0]?.active;
const product = async (id) =>
  (
    await sql`select p.active, c.client_id as category from public.menu_products p
                join public.menu_categories c on c.id = p.category_id
               where p.org_id = ${ORG} and p.client_id = ${id}`
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
  Promise.race([p.then(() => "resolved"), sleep(ms).then(() => "pending")]);
/**
 * Lock-based (not time-based) proof that `p`, running on backend `pid`, finishes WITHOUT ever being
 * blocked by `byPid`: polls pg_blocking_pids until `p` settles. Returns { done, blocked }; if it is
 * ever seen blocked by `byPid` it returns at once (the caller then releases `byPid`).
 */
async function finishesWithoutWaitingOn(p, pid, byPid) {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 600; i++) {
    if (done) return { done: true, blocked: false };
    const [row] =
      await sql`select ${byPid}::int = any(pg_blocking_pids(${pid})) as by from pg_stat_activity where pid = ${pid}`;
    if (row?.by) return { done: false, blocked: true };
    await sleep(20);
  }
  return { done, blocked: false };
}

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
    for (const id of ["c1", "c2", "c3", "c4", "c5", "c6-from", "c6-to"]) await category(owner, id);
    await owner.end();
    const editor = await session(EDITOR);
    await saveProduct(editor, "p6", "c6-from"); // an existing, active product for scenario 6
    await editor.end();
  }
  const [{ perms }] =
    await sql`select 'menu.create' = any(effective_permissions) and 'menu.edit' = any(effective_permissions) as perms
                from public.organization_members where org_id = ${ORG} and user_id = ${EDITOR}`;
  const [{ active, total }] =
    await sql`select count(*) filter (where active)::int as active, count(*)::int as total
                from public.menu_categories where org_id = ${ORG}`;
  const p6 = await product("p6");
  check(
    "fixture: exactly 7 categories, all active; product p6 active in c6-from; manager holds menu.create/menu.edit",
    total === 7 &&
      active === 7 &&
      p6?.active === true &&
      p6.category === "c6-from" &&
      perms === true,
    `${active}/${total} active, p6 ${JSON.stringify(p6)}`,
  );

  // ---- 1. save first, committed: the archive waits, then refuses
  {
    const editor = await session(EDITOR);
    const owner = await session(OWNER);
    await editor.c`begin`;
    await saveProduct(editor, "p1", "c1"); // category read FOR SHARE, transaction still open
    await owner.c`begin`;
    const arch = attempt("1 archive", archive(owner, "c1"));
    check(
      "1. the archive waits for the open save (blocked on the category row)",
      await blockedBy(owner.pid, editor.pid),
    );
    // Test of the cleanup only (never set in the suite): fail while one session holds a row lock and
    // the other waits for it; the finally block must still release everything and clean up.
    if (process.env.RACE_TEST_FAULT === "after-lock")
      throw new Error(
        "injected fault: one session holds the category lock, the other waits for it",
      );
    check("1. the archive is still waiting after 1.5 s", (await settled(arch, 1500)) === "pending");
    await editor.c`commit`;
    const outcome = await arch;
    check(
      "1. once the save commits, the archive is refused with category_in_use",
      outcome === "category_in_use",
      outcome,
    );
    await owner.c`commit`; // as a real client would: a wrongly accepted archive is persisted and caught below
    const p = await product("p1");
    check(
      "1. the category stays active and the product is active in it",
      (await catActive("c1")) === true && p?.active === true && p.category === "c1",
      JSON.stringify(p),
    );
    await editor.end();
    await owner.end();
  }

  // ---- 2. archive first, committed: the save waits, then refuses
  {
    const owner = await session(OWNER);
    const editor = await session(EDITOR);
    await owner.c`begin`;
    await archive(owner, "c2"); // category locked FOR UPDATE and archived, not committed
    await editor.c`begin`;
    const save = attempt("2 save", saveProduct(editor, "p2", "c2"));
    check(
      "2. the save waits for the archive in progress (blocked on the category row)",
      await blockedBy(editor.pid, owner.pid),
    );
    check("2. the save is still waiting after 1.5 s", (await settled(save, 1500)) === "pending");
    await owner.c`commit`;
    const outcome = await save;
    check(
      "2. once the archive commits, the save is refused with category_required",
      outcome === "category_required",
      outcome,
    );
    // COMMIT as a real client would: a refused save leaves an aborted transaction (COMMIT = ROLLBACK),
    // a save that wrongly went through is persisted and must be caught by the checks below.
    await editor.c`commit`;
    check(
      "2. the category is archived and the product does not exist",
      (await catActive("c2")) === false && (await product("p2")) === undefined,
    );
    await editor.end();
    await owner.end();
  }

  // ---- 3. save first, rolled back: the archive waits, then archives the empty category
  {
    const editor = await session(EDITOR);
    const owner = await session(OWNER);
    await editor.c`begin`;
    await saveProduct(editor, "p3", "c3");
    await owner.c`begin`;
    const arch = attempt("3 archive", archive(owner, "c3"));
    check("3. the archive waits for the open save", await blockedBy(owner.pid, editor.pid));
    await editor.c`rollback`;
    check("3. once the save rolls back, the archive succeeds", (await arch) === "ok");
    await owner.c`commit`;
    check(
      "3. the category is archived and the rolled-back product does not exist",
      (await catActive("c3")) === false && (await product("p3")) === undefined,
    );
    await editor.end();
    await owner.end();
  }

  // ---- 4. archive first, rolled back: the save waits, then saves into the active category
  {
    const owner = await session(OWNER);
    const editor = await session(EDITOR);
    await owner.c`begin`;
    await archive(owner, "c4");
    await editor.c`begin`;
    const save = attempt("4 save", saveProduct(editor, "p4", "c4"));
    check("4. the save waits for the archive in progress", await blockedBy(editor.pid, owner.pid));
    await owner.c`rollback`;
    check("4. once the archive rolls back, the save succeeds", (await save) === "ok");
    await editor.c`commit`;
    const p = await product("p4");
    check(
      "4. the category is still active and the product is active in it",
      (await catActive("c4")) === true && p?.active === true && p.category === "c4",
      JSON.stringify(p),
    );
    await editor.end();
    await owner.end();
  }

  // ---- 5. two saves into the same category do not wait for each other
  {
    const a = await session(EDITOR);
    const b = await session(OWNER);
    await a.c`begin`;
    await saveProduct(a, "p5a", "c5"); // holds FOR SHARE on c5
    await b.c`begin`;
    const second = attempt("5 second save", saveProduct(b, "p5b", "c5"));
    // proven with pg_blocking_pids while the first save is still open, not with a time window
    const run = await finishesWithoutWaitingOn(second, b.pid, a.pid);
    check(
      "5. a second save into the same category completes while the first is still open, never blocked by it",
      run.done && !run.blocked && (await second) === "ok",
      JSON.stringify(run),
    );
    await a.c`commit`;
    await b.c`commit`;
    check(
      "5. both products are active in the category",
      (await product("p5a"))?.active === true && (await product("p5b"))?.active === true,
    );
    await a.end();
    await b.end();
  }

  // ---- 6. an existing product moved into a category being archived
  {
    const owner = await session(OWNER);
    const editor = await session(EDITOR);
    await owner.c`begin`;
    await archive(owner, "c6-to");
    await editor.c`begin`;
    const move = attempt("6 move", saveProduct(editor, "p6", "c6-to"));
    check(
      "6. moving the existing product waits for the archive",
      await blockedBy(editor.pid, owner.pid),
    );
    await owner.c`commit`;
    const outcome = await move;
    check(
      "6. once the archive commits, the move is refused with category_required",
      outcome === "category_required",
      outcome,
    );
    await editor.c`commit`; // as a real client would (see scenario 2)
    const p = await product("p6");
    check(
      "6. the product is still active in its original category",
      p?.active === true && p.category === "c6-from",
      JSON.stringify(p),
    );
    await editor.end();
    await owner.end();
  }

  // ---- 7. invariants
  {
    const [{ n }] =
      await sql`select count(*)::int as n from public.menu_products p join public.menu_categories c on c.id = p.category_id
                 where p.org_id = ${ORG} and p.active and not c.active`;
    check("7. no active product in an archived category", n === 0, `${n} found`);
    const deadlocks = outcomes.filter(([, o]) =>
      /deadlock|lock timeout|canceling statement/i.test(o),
    );
    check(
      "7. no deadlock or lock timeout in any scenario",
      deadlocks.length === 0,
      JSON.stringify(deadlocks),
    );
    const audits = await sql`select target, action, count(*)::int as n from public.audit_logs
                               where org_id = ${ORG} and action in ('menu.archived', 'menu.saved') and metadata->>'kind' in ('category', 'product')
                                 and target is not null group by 1, 2 order by 1, 2`;
    const archived = audits
      .filter((a) => a.action === "menu.archived")
      .map((a) => `${a.target}:${a.n}`)
      .join(",");
    check(
      "7. exactly the committed archives are audited (c2, c3, c6-to), once each",
      archived === "c2:1,c3:1,c6-to:1",
      archived,
    );
    const productSaves = Number(
      (
        await sql`select count(*)::int as n from public.audit_logs
                   where org_id = ${ORG} and action = 'menu.saved' and metadata->>'kind' = 'product'`
      )[0].n,
    );
    // p6 (setup), p1, p4, p5a, p5b: the refused or rolled-back saves (p2, p3, p6 move) leave no row
    check(
      "7. exactly the committed product saves are audited (5)",
      productSaves === 5,
      String(productSaves),
    );
  }
} catch (e) {
  // An intermediate failure is reported as a failed check (the summary still prints, exit code 1).
  check("test aborted before its end", false, code(e));
} finally {
  // 1. Sessions still open (only after a failure): terminate their backends, which rolls back their
  //    transactions and releases their locks, then close them; nothing else is terminated.
  try {
    const closed = await closeOpenSessions();
    // a backend exits a moment after its client disconnects: wait up to 2 s for all of them
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
console.log(`Menu category race: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
