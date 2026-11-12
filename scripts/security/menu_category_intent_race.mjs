// Concurrency of category saves with an explicit intent (migration 0029): create / update /
// reactivate against each other, against the archive (0026) and against product saves (0027).
// LOCAL/CI QA stack ONLY.
//
// Two PostgreSQL sessions run the operations concurrently. REGRESSION scenarios (they FAIL with the
// 0028 body, which upserts every category save and re-activates it):
//   1. create x create, same id, first committed: the second waits, then is refused with
//      category_exists; the first creation is kept (no silent overwrite);
//   3. create while the same id is being archived: the creation waits for the archive, then is
//      refused (archive committed: category_archived; rolled back: category_exists); nothing is
//      overwritten or re-activated;
//   4. update x archive, archive first, committed: the update waits, then is refused with
//      category_archived; the category stays archived with its name (no implicit re-activation);
//   8. reactivate x reactivate: the second waits, then is refused with category_not_archived
//      (exactly one re-activation audited).
// BEHAVIOR scenarios (they prove the intents serialize correctly and add no deadlock):
//   2. create x create, first rolled back: the second waits, then creates the category;
//   5. update x archive, update first: the archive waits, then archives the renamed category;
//   6. update x archive, archive rolled back: the update waits, then renames the active category;
//   7. update x reactivate: the update waits for the re-activation, then renames the active category;
//   9. archive x product activation, product first: the archive waits, then category_in_use;
//  10. archive x product activation, archive first: the product save waits, then category_required.
// End: no active product in an inactive category, no deadlock or lock timeout, and the audit trail
// holds exactly the committed operations (menu.saved with the intent, menu.archived).
// Every wait is proven with pg_blocking_pids, not inferred from timing. Sessions end with COMMIT as a
// real client would (an operation that wrongly went through stays in the database and is caught).
// Every session is registered; the finally block terminates the ones still open (only this test's
// own pids) before cleaning up, and the cleanup connection has a lock_timeout.
//
// Isolation: the test creates its OWN organization and store and two synthetic members (owner,
// manager with the store) directly in the database, works only there and removes all of it at the
// end. NOT to be run during step 2b of the security suite (database without any organization).
//
//   QA_DB_URL=postgresql://...@127.0.0.1:55322/postgres node scripts/security/menu_category_intent_race.mjs
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
const OWNER2 = crypto.randomUUID(); // a second owner of the same organization (two owner sessions)
const EDITOR = crypto.randomUUID();
const org = isolatedOrg("intent", {
  taxRatePpm: 62500,
  members: [
    { userId: OWNER, role: "owner" },
    { userId: OWNER2, role: "owner" },
    { userId: EDITOR, role: "manager", store: true },
  ],
});
const ORG = org.orgId;
const STORE = org.locationId;

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
const saveCategory = (s, op, id, name = id) =>
  s.c`select public.save_operational_menu(${ORG}, 'category', ${s.c.json({ op, id, name })})`;
const archiveCategory = (s, id) =>
  s.c`select public.archive_operational_menu(${ORG}, 'category', ${id})`;
// The manager's products are sold at its own store (a manager cannot create all-stores products).
const saveProduct = (s, id, cat, active) =>
  s.c`select public.save_operational_menu(${ORG}, 'product', ${s.c.json({
    id,
    name: id,
    category: cat,
    priceCents: 300,
    prepTimeMinutes: 1,
    locationIds: [STORE],
    modifierGroups: [],
    active,
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
const categoryCount = async (id) =>
  (
    await sql`select count(*)::int as n from public.menu_categories where org_id = ${ORG} and client_id = ${id}`
  )[0].n;
const productActive = async (id) =>
  (
    await sql`select active from public.menu_products where org_id = ${ORG} and client_id = ${id}`
  )[0]?.active;
/** menu.saved audit rows of one category with a given intent (the audit target is the category id). */
const saves = async (id, op) =>
  (
    await sql`select count(*)::int as n from public.audit_logs a
                join public.menu_categories c on a.target = c.id::text
               where a.org_id = ${ORG} and c.org_id = ${ORG} and c.client_id = ${id}
                 and a.action = 'menu.saved' and a.metadata->>'kind' = 'category'
                 and a.metadata->>'op' = ${op}`
  )[0].n;
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
  Promise.race([p.then(() => "resolved"), sleep(ms).then(() => "pending")]);
/** Two sessions, A then B, each in an open transaction. */
async function pair(a, b) {
  const A = await session(a);
  const B = await session(b);
  await A.c`begin`;
  await B.c`begin`;
  return [A, B];
}
const endAll = async (...ss) => {
  for (const s of ss) await s.end();
};

try {
  // ---- setup: users, organization, store, members; categories c3, c3b, c4..c10; c7, c8 archived; products q9, q10 inactive
  await fixtures.unsafe(
    createTestUsersSql([
      { userId: OWNER, email: `${org.key}-owner@example.test` },
      { userId: OWNER2, email: `${org.key}-owner2@example.test` },
      { userId: EDITOR, email: `${org.key}-manager@example.test` },
    ]),
  );
  await fixtures.unsafe(createIsolatedOrgSql(org));
  {
    const owner = await session(OWNER);
    for (const id of ["c3", "c3b", "c4", "c5", "c6", "c7", "c8", "c9", "c10"])
      await saveCategory(owner, "create", id);
    await archiveCategory(owner, "c7");
    await archiveCategory(owner, "c8");
    const editor = await session(EDITOR);
    await saveProduct(editor, "q9", "c9", false);
    await saveProduct(editor, "q10", "c10", false);
    await endAll(owner, editor);
  }
  check(
    "fixture: c3..c10 exist; c7 and c8 archived; q9 and q10 inactive",
    (await category("c3"))?.active === true &&
      (await category("c7"))?.active === false &&
      (await category("c8"))?.active === false &&
      (await productActive("q9")) === false &&
      (await productActive("q10")) === false,
  );

  // ---- 1. create x create, same id, first committed
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await saveCategory(A, "create", "c1", "first");
    const second = attempt("1 create B", saveCategory(B, "create", "c1", "second"));
    check("1. the second creation waits for the first (unique id)", await blockedBy(B.pid, A.pid));
    check("1. still waiting after 1.5 s", (await settled(second, 1500)) === "pending");
    await A.c`commit`;
    const outcome = await second;
    check(
      "1. once the first commits, the second is refused with category_exists",
      outcome === "category_exists",
      outcome,
    );
    await B.c`commit`;
    const c = await category("c1");
    check(
      "1. exactly one category, the first creation kept (no silent overwrite), one create audited",
      (await categoryCount("c1")) === 1 &&
        c?.name === "first" &&
        c.active === true &&
        (await saves("c1", "create")) === 1,
      JSON.stringify(c),
    );
    await endAll(A, B);
  }

  // ---- 2. create x create, first rolled back
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await saveCategory(A, "create", "c2", "first");
    const second = attempt("2 create B", saveCategory(B, "create", "c2", "second"));
    check("2. the second creation waits for the first", await blockedBy(B.pid, A.pid));
    await A.c`rollback`;
    check("2. once the first rolls back, the second creates the category", (await second) === "ok");
    await B.c`commit`;
    const c = await category("c2");
    check(
      "2. one category (the second), one create audited",
      (await categoryCount("c2")) === 1 &&
        c?.name === "second" &&
        (await saves("c2", "create")) === 1,
      JSON.stringify(c),
    );
    await endAll(A, B);
  }

  // ---- 3. create while the same id is being archived: the creation waits for the archive (the
  //         row is being updated by an open transaction), then is refused; never an overwrite
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await archiveCategory(A, "c3"); // c3 locked and updated (active=false), not committed
    const create = attempt("3a create", saveCategory(B, "create", "c3", "overwrite"));
    check("3a. the creation waits for the archive in progress", await blockedBy(B.pid, A.pid));
    await A.c`commit`;
    const outcome = await create;
    check(
      "3a. once the archive commits, the creation is refused with category_archived (no overwrite, no re-activation)",
      outcome === "category_archived",
      outcome,
    );
    await B.c`commit`;
    const c = await category("c3");
    check(
      "3a. the category is archived with its name; only the setup creation is audited",
      c?.active === false && c.name === "c3" && (await saves("c3", "create")) === 1,
      JSON.stringify(c),
    );
    await endAll(A, B);
  }
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await archiveCategory(A, "c3b");
    const create = attempt("3b create", saveCategory(B, "create", "c3b", "overwrite"));
    check("3b. the creation waits for the archive in progress", await blockedBy(B.pid, A.pid));
    await A.c`rollback`;
    const outcome = await create;
    check(
      "3b. once the archive rolls back, the creation is refused with category_exists (no overwrite)",
      outcome === "category_exists",
      outcome,
    );
    await B.c`commit`;
    const c = await category("c3b");
    check(
      "3b. the category is active with its original name; only the setup creation is audited",
      c?.active === true && c.name === "c3b" && (await saves("c3b", "create")) === 1,
      JSON.stringify(c),
    );
    await endAll(A, B);
  }

  // ---- 4. update x archive, archive first, committed
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await archiveCategory(A, "c4");
    const upd = attempt("4 update", saveCategory(B, "update", "c4", "c4 renamed"));
    check("4. the update waits for the archive in progress", await blockedBy(B.pid, A.pid));
    await A.c`commit`;
    const outcome = await upd;
    check(
      "4. once the archive commits, the update is refused with category_archived",
      outcome === "category_archived",
      outcome,
    );
    await B.c`commit`;
    const c = await category("c4");
    check(
      "4. the category stays archived with its name (no implicit re-activation), no update audited",
      c?.active === false && c.name === "c4" && (await saves("c4", "update")) === 0,
      JSON.stringify(c),
    );
    await endAll(A, B);
  }

  // ---- 5. update x archive, update first, committed
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await saveCategory(A, "update", "c5", "c5 renamed");
    const arch = attempt("5 archive", archiveCategory(B, "c5"));
    check("5. the archive waits for the update in progress", await blockedBy(B.pid, A.pid));
    await A.c`commit`;
    check("5. once the update commits, the archive succeeds", (await arch) === "ok");
    await B.c`commit`;
    const c = await category("c5");
    check(
      "5. the renamed category is archived",
      c?.active === false && c.name === "c5 renamed" && (await saves("c5", "update")) === 1,
      JSON.stringify(c),
    );
    await endAll(A, B);
  }

  // ---- 6. update x archive, archive rolled back
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await archiveCategory(A, "c6");
    const upd = attempt("6 update", saveCategory(B, "update", "c6", "c6 renamed"));
    check("6. the update waits for the archive in progress", await blockedBy(B.pid, A.pid));
    await A.c`rollback`;
    check("6. once the archive rolls back, the update succeeds", (await upd) === "ok");
    await B.c`commit`;
    const c = await category("c6");
    check(
      "6. the category is active and renamed",
      c?.active === true && c.name === "c6 renamed",
      JSON.stringify(c),
    );
    await endAll(A, B);
  }

  // ---- 7. update x reactivate (the category is archived)
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await saveCategory(A, "reactivate", "c7");
    const upd = attempt("7 update", saveCategory(B, "update", "c7", "c7 renamed"));
    check("7. the update waits for the re-activation in progress", await blockedBy(B.pid, A.pid));
    await A.c`commit`;
    check("7. once the re-activation commits, the update succeeds", (await upd) === "ok");
    await B.c`commit`;
    const c = await category("c7");
    check(
      "7. the category is active and renamed; one reactivate and one update audited",
      c?.active === true &&
        c.name === "c7 renamed" &&
        (await saves("c7", "reactivate")) === 1 &&
        (await saves("c7", "update")) === 1,
      JSON.stringify(c),
    );
    await endAll(A, B);
  }

  // ---- 8. reactivate x reactivate
  {
    const [A, B] = await pair(OWNER, OWNER2);
    await saveCategory(A, "reactivate", "c8");
    const second = attempt("8 reactivate B", saveCategory(B, "reactivate", "c8"));
    check("8. the second re-activation waits for the first", await blockedBy(B.pid, A.pid));
    await A.c`commit`;
    const outcome = await second;
    check(
      "8. once the first commits, the second is refused with category_not_archived",
      outcome === "category_not_archived",
      outcome,
    );
    await B.c`commit`;
    check(
      "8. the category is active; exactly one re-activation audited",
      (await category("c8"))?.active === true && (await saves("c8", "reactivate")) === 1,
    );
    await endAll(A, B);
  }

  // ---- 9. archive x product activation, product first (committed)
  {
    const [E, A] = await pair(EDITOR, OWNER);
    await saveProduct(E, "q9", "c9", true); // category read FOR SHARE, transaction open
    const arch = attempt("9 archive", archiveCategory(A, "c9"));
    check("9. the archive waits for the product activation", await blockedBy(A.pid, E.pid));
    await E.c`commit`;
    const outcome = await arch;
    check(
      "9. once the product activation commits, the archive is refused with category_in_use",
      outcome === "category_in_use",
      outcome,
    );
    await A.c`commit`;
    check(
      "9. the category is active and the product active in it",
      (await category("c9"))?.active === true && (await productActive("q9")) === true,
    );
    await endAll(E, A);
  }

  // ---- 10. archive x product activation, archive first (committed)
  {
    const [A, E] = await pair(OWNER, EDITOR);
    await archiveCategory(A, "c10");
    const save = attempt("10 activate", saveProduct(E, "q10", "c10", true));
    check("10. the product activation waits for the archive", await blockedBy(E.pid, A.pid));
    await A.c`commit`;
    const outcome = await save;
    check(
      "10. once the archive commits, the product activation is refused with category_required",
      outcome === "category_required",
      outcome,
    );
    await E.c`commit`;
    check(
      "10. the category is archived and the product stays inactive",
      (await category("c10"))?.active === false && (await productActive("q10")) === false,
    );
    await endAll(A, E);
  }

  // ---- end: invariants and audit trail
  {
    const [{ n }] =
      await sql`select count(*)::int as n from public.menu_products p join public.menu_categories c on c.id = p.category_id
                 where p.org_id = ${ORG} and p.active and not c.active`;
    check("end. no active product in an inactive category", n === 0, `${n} found`);
    const deadlocks = outcomes.filter(([, o]) =>
      /deadlock|lock timeout|canceling statement/i.test(o),
    );
    check(
      "end. no deadlock or lock timeout in any scenario",
      deadlocks.length === 0,
      JSON.stringify(deadlocks),
    );
    const rows =
      await sql`select action, coalesce(metadata->>'op', metadata->>'kind') as what, count(*)::int as n
                             from public.audit_logs where org_id = ${ORG}
                              and action in ('menu.saved', 'menu.archived')
                            group by 1, 2 order by 1, 2`;
    const trail = rows.map((r) => `${r.action}/${r.what}:${r.n}`).join(",");
    // creates: setup c3, c3b, c4..c10 (9) + c1 first + c2 second = 11; updates: c5, c6, c7 = 3;
    // reactivations: c7, c8 = 2; product saves: q9, q10 (setup) + q9 activation = 3;
    // archives: c7, c8 (setup) + c3, c4, c5, c10 = 6. Refused or rolled-back operations add nothing.
    const expected =
      "menu.archived/category:6,menu.saved/create:11,menu.saved/product:3,menu.saved/reactivate:2,menu.saved/update:3";
    check("end. the audit trail holds exactly the committed operations", trail === expected, trail);
  }
} catch (e) {
  check("test aborted before its end", false, code(e));
} finally {
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
  try {
    await fixtures.unsafe(dropIsolatedOrgsSql([ORG]));
    await fixtures.unsafe(dropTestUsersSql([OWNER, OWNER2, EDITOR]));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([ORG]).replace(/;\s*$/, "")}) x(n)`,
    );
    const [{ u }] =
      await sql`select count(*)::int as u from auth.users where id in (${OWNER}, ${OWNER2}, ${EDITOR})`;
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
  `Menu category intent race: ${results.length - failed.length}/${results.length} passed`,
);
if (failed.length) process.exit(1);
