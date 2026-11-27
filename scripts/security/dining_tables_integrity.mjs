// Dining room tables (0037): who may read and write sections, tables and table status, where, and
// what happens when two people act at once. LOCAL/CI QA stack ONLY (the target guard refuses any other
// database). Direct RPC calls and direct reads as each member, in real PostgreSQL sessions
// (SET ROLE authenticated + JWT claims, so RLS and the security-definer checks run as in the API).
//
//   F  the table_service feature: while it is off nobody (owners included) reads or writes anything
//      and the permissions are not shown; turned on for ONE organization only
//   P  permissions and store scope: owner; manager with and without the store; cashier profile
//      (view + status); staff without a profile (nothing); staff granted tables.manage; a second
//      store of the same organization; another organization; anon; direct writes refused
//   V  validation and rules: labels, seats, duplicates (case-insensitive, active rows only), sections
//      of another store, archive rules (occupied table, section with tables), status history,
//      audit rows scoped to the store, suspended organization
//   C  concurrency (two sessions, COMMIT and ROLLBACK): two status changes from the same screen state
//      (the second is refused with status_conflict, never a silent overwrite); archiving a section
//      while a table is saved into it, in both orders (never an active table in an archived section)
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/dining_tables_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:dining-tables").catch(exitOnRefusal);

const KEYS = ["OWNER", "MGR", "MGROUT", "CASH", "STAFF", "STAFFG", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("tables-a", {
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.MGR, role: "manager", store: true },
    { userId: U.MGROUT, role: "manager", store: false },
    { userId: U.CASH, role: "staff", store: true },
    { userId: U.STAFF, role: "staff", store: true },
    { userId: U.STAFFG, role: "staff", store: true },
  ],
});
const B = isolatedOrg("tables-b", { members: [{ userId: U.OWNERB, role: "owner" }] });
const S1 = A.locationId;
const S2 = crypto.randomUUID(); // second store of A: only the owner may reach it
const ORGS = [A.orgId, B.orgId];
const mid = (uid) => A.members.find((m) => m.userId === uid).memberId;

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const code = (e) => String(e?.message ?? e).split("\n")[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
/** One call as `uid` in its own session: its value, or the error code. */
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

const saveSection = (c, org, store, id, name, sort = 0) =>
  c`select public.save_dining_section(${org}, ${store}, ${name}, ${sort}, ${id}) as id`.then(
    (r) => r[0].id,
  );
const archiveSection = (c, org, store, id) =>
  c`select public.archive_dining_section(${org}, ${store}, ${id})`.then(() => "ok");
const saveTable = (c, org, store, id, label, seats = 4, section = null, sort = 0) =>
  c`select public.save_dining_table(${org}, ${store}, ${label}, ${seats}, ${sort}, ${id}, ${section}) as id`.then(
    (r) => r[0].id,
  );
const archiveTable = (c, org, store, id) =>
  c`select public.archive_dining_table(${org}, ${store}, ${id})`.then(() => "ok");
const setStatus = (c, org, store, id, status, expected = null) =>
  c`select public.set_dining_table_status(${org}, ${store}, ${id}, ${status}, ${expected}) as s`.then(
    (r) => r[0].s,
  );
const readTables = (c) =>
  c`select id::text, location_id::text from public.dining_tables order by label`.then((r) => r);
const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

/** Rows of the module in both organizations plus their audit rows: a refusal changes none of it. */
const state = async () =>
  JSON.stringify(
    await sql`select
      (select coalesce(json_agg(t order by t.id), '[]') from public.dining_tables t where org_id = any(${ORGS})) as t,
      (select coalesce(json_agg(s order by s.id), '[]') from public.dining_sections s where org_id = any(${ORGS})) as s,
      (select count(*)::int from public.dining_table_status_events where org_id = any(${ORGS})) as e,
      (select count(*)::int from public.audit_logs where org_id = any(${ORGS}) and action like 'tables.%') as a`,
  );
async function refused(name, expected, uid, fn, opts) {
  const before = await state();
  const r = await as(uid, fn, opts);
  const same = (await state()) === before;
  const ok = (expected instanceof RegExp ? expected.test(String(r)) : r === expected) && same;
  check(name, ok, `${r}${same ? "" : " — STATE CHANGED"}`);
}
const setFeature = (org, on) =>
  sql`insert into public.org_features (org_id, feature, enabled) values (${org}, 'table_service', ${on})
      on conflict (org_id, feature) do update set enabled = excluded.enabled`;

try {
  // ---------------------------------------------------------------- fixture
  await sql.unsafe(
    createTestUsersSql(
      KEYS.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql`insert into public.locations (id, org_id, slug, name, address)
            values (${S2}, ${A.orgId}, ${`t_${A.key}_store2`}, ${`Store ${A.key} 2`}, '2 Test Street')`;
  const [{ id: CASHIER }] =
    await sql`select id from public.permission_profiles where is_system and key = 'cashier'`;
  await sql`update public.organization_members set profile_id = ${CASHIER} where id = ${mid(U.CASH)}`;
  await sql`update public.organization_members set extra_permissions = array['tables.manage']
             where id = ${mid(U.STAFFG)}`;
  await sql`update public.organization_members
               set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions)
             where org_id = ${A.orgId}`;

  // ---------------------------------------------------------------- F. feature off (default)
  const [{ def }] =
    await sql`select default_enabled as def from public.feature_catalog where key = 'table_service'`;
  check("F1 table_service exists and is off by default", def === false);
  await refused(
    "F2 feature off: the owner cannot create a section",
    "permission_denied",
    U.OWNER,
    (c) => saveSection(c, A.orgId, S1, null, "Patio"),
  );
  await sql`insert into public.dining_tables (org_id, location_id, label) values (${A.orgId}, ${S1}, 'Hidden')`;
  check(
    "F3 feature off: the owner reads no table (a row exists)",
    (await as(U.OWNER, readTables)).length === 0,
  );
  const ownerPerms = await as(
    U.OWNER,
    async (c) => (await c`select public.my_permissions(${A.orgId}) as p`)[0].p,
  );
  check(
    "F4 feature off: my_permissions shows no tables.* permission",
    Array.isArray(ownerPerms) && !ownerPerms.some((p) => p.startsWith("tables.")),
  );
  await sql`delete from public.dining_tables where org_id = ${A.orgId}`;
  await setFeature(A.orgId, true);
  const ownerPermsOn = await as(
    U.OWNER,
    async (c) => (await c`select public.my_permissions(${A.orgId}) as p`)[0].p,
  );
  check(
    "F5 feature on for A: the owner holds tables.view, tables.status and tables.manage",
    ["tables.view", "tables.status", "tables.manage"].every((p) => ownerPermsOn.includes(p)),
  );

  // ---------------------------------------------------------------- P. permissions and scope
  const SEC = await as(U.OWNER, (c) => saveSection(c, A.orgId, S1, null, "Patio", 1));
  check("P1 owner creates a section", isUuid(SEC), String(SEC));
  const T1 = await as(U.OWNER, (c) => saveTable(c, A.orgId, S1, null, "T1", 4, SEC));
  check("P1 owner creates a table in it", isUuid(T1), String(T1));
  const T2 = await as(U.MGR, (c) => saveTable(c, A.orgId, S1, null, "T2", 2));
  check("P2 manager of the store creates a table (default permissions)", isUuid(T2), String(T2));
  await refused("P2 manager WITHOUT the store is refused", "forbidden", U.MGROUT, (c) =>
    saveTable(c, A.orgId, S1, null, "T9"),
  );
  check(
    "P2 manager WITHOUT the store reads none of its tables",
    (await as(U.MGROUT, readTables)).length === 0,
  );
  await refused("P3 cashier profile cannot create a table", "permission_denied", U.CASH, (c) =>
    saveTable(c, A.orgId, S1, null, "T9"),
  );
  check("P3 cashier profile reads the store's tables", (await as(U.CASH, readTables)).length === 2);
  check(
    "P3 cashier profile changes a status",
    (await as(U.CASH, (c) => setStatus(c, A.orgId, S1, T1, "reserved"))) === "reserved",
  );
  await refused("P3 cashier profile cannot archive a table", "permission_denied", U.CASH, (c) =>
    archiveTable(c, A.orgId, S1, T2),
  );
  await refused(
    "P4 staff without a profile cannot change a status",
    "permission_denied",
    U.STAFF,
    (c) => setStatus(c, A.orgId, S1, T2, "cleaning"),
  );
  check("P4 staff without a profile reads nothing", (await as(U.STAFF, readTables)).length === 0);
  const T3 = await as(U.STAFFG, (c) => saveTable(c, A.orgId, S1, null, "T3"));
  check("P5 staff granted tables.manage creates a table", isUuid(T3), String(T3));
  await refused(
    "P5 ...but cannot change a status (tables.status not granted)",
    "permission_denied",
    U.STAFFG,
    (c) => setStatus(c, A.orgId, S1, T3, "cleaning"),
  );
  const X1 = await as(U.OWNER, (c) => saveTable(c, A.orgId, S2, null, "X1"));
  check("P6 owner creates a table in the second store", isUuid(X1), String(X1));
  check(
    "P6 manager of store 1 does not read the second store's table",
    !(await as(U.MGR, readTables)).some((r) => r.id === X1),
  );
  await refused("P6 manager of store 1 cannot change it", "forbidden", U.MGR, (c) =>
    setStatus(c, A.orgId, S2, X1, "cleaning"),
  );
  await refused(
    "P6 a table id of store 2 sent with store 1 is not found",
    "table_not_found",
    U.MGR,
    (c) => setStatus(c, A.orgId, S1, X1, "cleaning"),
  );
  await refused(
    "P7 another organization's owner, with A's store, is refused",
    "forbidden",
    U.OWNERB,
    (c) => saveTable(c, A.orgId, S1, null, "B1"),
  );
  await refused(
    "P7 ...and with its own organization id and A's store",
    "forbidden",
    U.OWNERB,
    (c) => setStatus(c, B.orgId, S1, T1, "cleaning"),
  );
  check(
    "P7 another organization's owner reads none of A's tables",
    (await as(U.OWNERB, readTables)).length === 0,
  );
  await refused(
    "P7 feature off for B: B's owner cannot create a table in B's own store",
    "permission_denied",
    U.OWNERB,
    (c) => saveTable(c, B.orgId, B.locationId, null, "B1"),
  );
  await refused(
    "P8 anon cannot call the RPCs",
    /permission denied for function/,
    null,
    (c) => setStatus(c, A.orgId, S1, T1, "cleaning"),
    { role: "anon" },
  );
  check(
    "P8 anon reads no table",
    /permission denied/.test(String(await as(null, readTables, { role: "anon" }))),
  );
  for (const [label, q] of [
    [
      "insert",
      (c) =>
        c`insert into public.dining_tables (org_id, location_id, label) values (${A.orgId}, ${S1}, 'Z')`,
    ],
    ["update", (c) => c`update public.dining_tables set status = 'cleaning' where id = ${T1}`],
    ["delete", (c) => c`delete from public.dining_tables where id = ${T1}`],
    [
      "section insert",
      (c) =>
        c`insert into public.dining_sections (org_id, location_id, name) values (${A.orgId}, ${S1}, 'Z')`,
    ],
    [
      "event insert",
      (c) =>
        c`insert into public.dining_table_status_events (org_id, location_id, table_id, from_status, to_status, actor_id) values (${A.orgId}, ${S1}, ${T1}, 'available', 'cleaning', ${U.OWNER})`,
    ],
  ])
    await refused(`P9 no direct ${label}, even for the owner`, /permission denied/, U.OWNER, q);

  // ---------------------------------------------------------------- V. validation and rules
  await refused("V1 empty label", "invalid_label", U.OWNER, (c) =>
    saveTable(c, A.orgId, S1, null, "   "),
  );
  await refused("V1 label over 20 characters", "invalid_label", U.OWNER, (c) =>
    saveTable(c, A.orgId, S1, null, "x".repeat(21)),
  );
  await refused("V1 zero seats", "invalid_seats", U.OWNER, (c) =>
    saveTable(c, A.orgId, S1, null, "T8", 0),
  );
  await refused("V1 duplicate label, other case and spaces", "table_label_taken", U.OWNER, (c) =>
    saveTable(c, A.orgId, S1, null, "  t1 "),
  );
  await refused("V1 renaming onto another table's label", "table_label_taken", U.OWNER, (c) =>
    saveTable(c, A.orgId, S1, T2, "T1", 2),
  );
  const XT1 = await as(U.OWNER, (c) => saveTable(c, A.orgId, S2, null, "T1"));
  check("V1 the same label in another store is fine", isUuid(XT1), String(XT1));
  const SEC2 = await as(U.OWNER, (c) => saveSection(c, A.orgId, S2, null, "Bar"));
  await refused("V2 a section of another store", "section_not_found", U.OWNER, (c) =>
    saveTable(c, A.orgId, S1, T2, "T2", 2, SEC2),
  );
  await refused("V2 duplicate section name", "section_name_taken", U.OWNER, (c) =>
    saveSection(c, A.orgId, S1, null, "patio"),
  );
  await refused("V3 invalid status", "invalid_status", U.OWNER, (c) =>
    setStatus(c, A.orgId, S1, T1, "dirty"),
  );
  await refused(
    "V3 the screen showed another status: refused, nothing written",
    "status_conflict",
    U.CASH,
    (c) => setStatus(c, A.orgId, S1, T1, "occupied", "available"),
  );
  const before = await state();
  const same = await as(U.CASH, (c) => setStatus(c, A.orgId, S1, T1, "reserved", "reserved"));
  check(
    "V3 setting the status it already has writes nothing",
    same === "reserved" && (await state()) === before,
  );
  await as(U.CASH, (c) => setStatus(c, A.orgId, S1, T1, "occupied", "reserved"));
  const events =
    await sql`select from_status, to_status, actor_id::text from public.dining_table_status_events
               where table_id = ${T1} order by created_at`;
  check(
    "V3 status history: available→reserved→occupied, by the cashier",
    JSON.stringify(events.map((e) => [e.from_status, e.to_status])) ===
      JSON.stringify([
        ["available", "reserved"],
        ["reserved", "occupied"],
      ]) && events.every((e) => e.actor_id === U.CASH),
  );
  const [row] =
    await sql`select status, status_changed_by::text from public.dining_tables where id = ${T1}`;
  check(
    "V3 the table records the last change and who made it",
    row.status === "occupied" && row.status_changed_by === U.CASH,
  );
  await refused("V4 an occupied table cannot be archived", "table_occupied", U.OWNER, (c) =>
    archiveTable(c, A.orgId, S1, T1),
  );
  await refused(
    "V4 a section with an active table cannot be archived",
    "section_not_empty",
    U.OWNER,
    (c) => archiveSection(c, A.orgId, S1, SEC),
  );
  await as(U.CASH, (c) => setStatus(c, A.orgId, S1, T1, "available"));
  check(
    "V4 archive the table, then the section",
    (await as(U.OWNER, (c) => archiveTable(c, A.orgId, S1, T1))) === "ok" &&
      (await as(U.OWNER, (c) => archiveSection(c, A.orgId, S1, SEC))) === "ok",
  );
  const T1b = await as(U.OWNER, (c) => saveTable(c, A.orgId, S1, null, "T1"));
  check("V4 an archived table's label can be reused", isUuid(T1b) && T1b !== T1, String(T1b));
  await refused("V4 an archived table cannot change status", "table_not_found", U.CASH, (c) =>
    setStatus(c, A.orgId, S1, T1, "cleaning"),
  );
  check(
    "V4 archived tables are still readable (history)",
    (await as(U.MGR, readTables)).some((r) => r.id === T1),
  );
  const audit = await sql`select action, location_id::text as loc from public.audit_logs
                           where org_id = ${A.orgId} and action like 'tables.%' order by created_at`;
  const actions = new Set(audit.map((a) => a.action));
  check(
    "V5 saves and archives are audited, scoped to the store; status changes are not audited",
    [
      "tables.section_saved",
      "tables.table_saved",
      "tables.table_archived",
      "tables.section_archived",
    ].every((a) => actions.has(a)) &&
      audit.every((a) => a.loc === S1 || a.loc === S2) &&
      !audit.some((a) => a.action.includes("status")),
    `${audit.length} rows`,
  );
  await sql`update public.organizations set status = 'suspended' where id = ${A.orgId}`;
  await refused(
    "V6 suspended organization: no status change",
    /suspended|inactive|forbidden/,
    U.OWNER,
    (c) => setStatus(c, A.orgId, S1, T2, "cleaning"),
  );
  await sql`update public.organizations set status = 'active' where id = ${A.orgId}`;

  // ---------------------------------------------------------------- C. concurrency
  for (const end of ["commit", "rollback"]) {
    await as(U.CASH, (c) => setStatus(c, A.orgId, S1, T2, "available"));
    const first = await session(U.CASH);
    const second = await session(U.MGR);
    await first.c`begin`;
    const r1 = await setStatus(first.c, A.orgId, S1, T2, "occupied", "available").catch(code);
    const attempt = setStatus(second.c, A.orgId, S1, T2, "reserved", "available").catch(code);
    const waited = await blockedBy(second.pid, first.pid);
    await first.c.unsafe(end);
    const r2 = await attempt;
    const [{ status }] = await sql`select status from public.dining_tables where id = ${T2}`;
    if (end === "commit")
      check(
        "C1 COMMIT: two people change the same table from the same screen: the second waits and is refused",
        waited && r1 === "occupied" && r2 === "status_conflict" && status === "occupied",
        `${waited} ${r1} ${r2} ${status}`,
      );
    else
      check(
        "C1 ROLLBACK: the first change is undone, the second then applies",
        waited && r1 === "occupied" && r2 === "reserved" && status === "reserved",
        `${waited} ${r1} ${r2} ${status}`,
      );
    await first.end();
    await second.end();
  }
  for (const end of ["commit", "rollback"]) {
    // archive first, a table saved into the section meanwhile
    const S = await as(U.OWNER, (c) => saveSection(c, A.orgId, S1, null, `Arch ${end}`));
    const first = await session(U.OWNER);
    const second = await session(U.MGR);
    await first.c`begin`;
    const r1 = await archiveSection(first.c, A.orgId, S1, S).catch(code);
    const attempt = saveTable(second.c, A.orgId, S1, null, `A-${end}`, 4, S).catch(code);
    const waited = await blockedBy(second.pid, first.pid);
    await first.c.unsafe(end);
    const r2 = await attempt;
    const [{ n }] =
      await sql`select count(*)::int n from public.dining_tables t join public.dining_sections s on s.id = t.section_id
                 where s.id = ${S} and t.archived_at is null and s.archived_at is not null`;
    check(
      `C2 ${end.toUpperCase()}: archive a section while a table is saved into it`,
      waited &&
        r1 === "ok" &&
        (end === "commit" ? r2 === "section_not_found" : isUuid(r2)) &&
        n === 0,
      `${waited} ${r1} ${r2}`,
    );
    await first.end();
    await second.end();
  }
  for (const end of ["commit", "rollback"]) {
    // a table saved first, the section archived meanwhile
    const S = await as(U.OWNER, (c) => saveSection(c, A.orgId, S1, null, `Save ${end}`));
    const first = await session(U.MGR);
    const second = await session(U.OWNER);
    await first.c`begin`;
    const r1 = await saveTable(first.c, A.orgId, S1, null, `S-${end}`, 4, S).catch(code);
    const attempt = archiveSection(second.c, A.orgId, S1, S).catch(code);
    const waited = await blockedBy(second.pid, first.pid);
    await first.c.unsafe(end);
    const r2 = await attempt;
    const [{ n }] =
      await sql`select count(*)::int n from public.dining_tables t join public.dining_sections s on s.id = t.section_id
                 where s.id = ${S} and t.archived_at is null and s.archived_at is not null`;
    check(
      `C3 ${end.toUpperCase()}: save a table into a section while it is archived`,
      waited &&
        isUuid(r1) &&
        (end === "commit" ? r2 === "section_not_empty" : r2 === "ok") &&
        n === 0,
      `${waited} ${r1} ${r2}`,
    );
    await first.end();
    await second.end();
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
console.log(`Dining room tables: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
