// Security closure rollback and re-application rehearsal (0034, 0035, 0036; docs/operations/security-closure).
// LOCAL/CI QA stack ONLY: it changes the schema of the database it runs on and leaves it re-applied
// (same functions, policies, triggers and privileges as before — checked), so the security suite runs
// it after the M2 rehearsal, LAST.
//
//   1. fixture: an organization with an owner, an ownerless organization and a platform admin;
//   2. 0036-, 0035- and 0034-rollback.sql in ONE transaction: the basis-point sale RPCs are callable by
//      authenticated again (never anon or service_role); admin_assign_owner and
//      resolve_pending_pos_sale have their previous bodies (0001, 0033), the reader and the audit
//      helper are gone, both 0034 triggers stay with no-op functions, the activity log has the 0019
//      policy; the private store, its rows and the column privilege of the closed keys are KEPT (the
//      texts already moved are not exposed again; NEW events are, see the WARNING of 0035-rollback);
//   3. while rolled back, resolutions store the text the 0033 way (closed key + audit), for both
//      outcomes, plus a closed key written outside the RPC;
//   4. 0034 + 0035 + 0036 again in ONE transaction: every text is MOVED exactly (same text, linked from its
//      audit event, reason_length right, closed keys NULL), audited per organization, nothing left;
//      functions, policies, triggers and privileges identical to step 1; the closed key still refuses
//      the sale; the owner rule is back;
//   5. 0035 once more: idempotent (nothing moved, nothing audited, nothing changed);
//   6. the M2 rollback and then the 0035 rollback: resolve_pending_pos_sale is NOT recreated; the M2
//      re-application ends exactly in the starting state.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/security_closure_rollback.mjs
import crypto from "node:crypto";
import fs from "node:fs";
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
await assertDisposableDb(DB_URL, "test:security-closure-rollback").catch(exitOnRefusal);
const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const ROLLBACK_0034 = read("docs/operations/security-closure/0034-rollback.sql");
const ROLLBACK_0035 = read("docs/operations/security-closure/0035-rollback.sql");
const M0034 = read("drizzle/migrations/0034_platform_owner_assignment_guard.sql");
const M0035 = read("drizzle/migrations/0035_pending_sale_reason_privacy.sql");
const ROLLBACK_0036 = read("docs/operations/security-closure/0036-rollback.sql");
const M0036 = read("drizzle/migrations/0036_retire_legacy_pos_sale_rpcs.sql");
const legacyCallable = async () =>
  (
    await sql`select string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'execute') || ':' ||
                 (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')), ',' order by p.proname) as v
            from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('create_pos_sale', 'finalize_pos_sale_atomic', 'persist_finalized_pos_sale_atomic')`
  )[0].v;
const M2_ROLLBACK = read("docs/operations/m2-rollback/rollback.sql");
const M2_REAPPLY = read("docs/operations/m2-rollback/reapply.sql");
const MARKER = "[moved to pos_pending_resolution_reasons]";

const RATE = 50000;
const U = Object.fromEntries(["OWNER", "PLAT", "NEW"].map((k) => [k, crypto.randomUUID()]));
const org = isolatedOrg("scrb", {
  taxRatePpm: RATE,
  members: [{ userId: U.OWNER, role: "owner" }],
});
const lone = isolatedOrg("scrb-lone");
const ORG = org.orgId;
const STORE = org.locationId;
const PRODUCT = `scrb-soda-${org.key}`;
const TEXT = {
  resolved: "Rolled back window: customer left without paying",
  recovered: "Rolled back window: the sale had been recorded",
  direct: "Written outside the RPC during the rollback window",
};

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const code = (e) => String(e?.message ?? e).split("\n")[0];
async function as(uid, fn) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    await c`select set_config('request.jwt.claim.sub', ${uid}, false)`;
    await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, false)`;
    await c`set role authenticated`;
    return await fn(c);
  } catch (e) {
    return code(e);
  } finally {
    await c.end({ timeout: 5 });
  }
}
const sale = (c, key) =>
  c`select public.persist_finalized_pos_sale_atomic_v2(${ORG}, ${STORE}, 'takeout', 'Closure rollback',
      _tax_rate_ppm => ${RATE}, _items => ${c.json([{ product_id: PRODUCT, quantity: 1, modifiers: [] }])},
      _client_order_id => ${key}, _payment_method => 'cash') as id`.then((r) => r[0].id);
const resolve = (c, key, text) =>
  c`select public.resolve_pending_pos_sale(${ORG}, ${STORE}, ${key}, ${text}) as r`.then(
    (r) => r[0].r.status,
  );
const assign = (c, o, email) =>
  c`select public.admin_assign_owner(${o}, ${email}, 'Identity checked on a call, ticket QA-9')`.then(
    () => "ok",
  );
/** Functions (body, settings, privileges), policies, triggers, and the privileges/constraints of the two tables. */
const schema = async () =>
  (
    await sql`select
      (select md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(p.prosrc)
                  || coalesce(array_to_string(p.proconfig, ','), '') || p.prosecdef || coalesce(array_to_string(p.proacl, ','), 'default'),
                  ';' order by p.proname, pg_get_function_identity_arguments(p.oid)))
         from pg_proc p where p.pronamespace = 'public'::regnamespace) as functions,
      (select md5(string_agg(c.relname || '.' || polname || ':' || pg_get_expr(polqual, polrelid) || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ';' order by c.relname, polname))
         from pg_policy join pg_class c on c.oid = polrelid where c.relnamespace = 'public'::regnamespace) as policies,
      (select md5(string_agg(c.relname || '.' || tgname || ':' || pg_get_triggerdef(t.oid), ';' order by c.relname, tgname))
         from pg_trigger t join pg_class c on c.oid = t.tgrelid where not tgisinternal and c.relnamespace = 'public'::regnamespace) as triggers,
      (select md5(string_agg(c.relname || ':' || coalesce(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity, ';' order by c.relname))
         from pg_class c where c.oid in ('public.pos_sale_key_voids'::regclass, 'public.pos_pending_resolution_reasons'::regclass)) as table_acl,
      (select md5(string_agg(a.attrelid::regclass || '.' || a.attname || ':' || a.attnotnull || ':' || coalesce(array_to_string(a.attacl, ','), ''), ';' order by a.attrelid::regclass::text, a.attnum))
         from pg_attribute a where a.attrelid in ('public.pos_sale_key_voids'::regclass, 'public.pos_pending_resolution_reasons'::regclass)
          and a.attnum > 0 and not a.attisdropped) as columns,
      (select md5(string_agg(conname || ':' || pg_get_constraintdef(oid), ';' order by conname))
         from pg_constraint where conrelid in ('public.pos_sale_key_voids'::regclass, 'public.pos_pending_resolution_reasons'::regclass)) as constraints`
  )[0];
const src = async (sig) =>
  (await sql`select prosrc from pg_proc where oid = to_regprocedure(${sig})`)[0]?.prosrc ?? null;

try {
  // ---- 1. fixture
  await sql.unsafe(
    createTestUsersSql(
      Object.entries(U).map(([k, id]) => ({
        userId: id,
        email: `${org.key}-${k.toLowerCase()}@example.test`,
      })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(org));
  await sql.unsafe(createIsolatedOrgSql(lone));
  await sql.unsafe(
    `insert into public.user_roles(user_id, role) values ('${U.PLAT}', 'platform_admin');`,
  );
  await as(U.OWNER, async (c) => {
    await c`select public.save_operational_menu(${ORG}, 'category', ${c.json({ op: "create", id: `scrb-drinks-${org.key}`, name: "Drinks" })})`;
    await c`select public.save_operational_menu(${ORG}, 'product', ${c.json({ id: PRODUCT, name: "Closure soda", category: `scrb-drinks-${org.key}`, priceCents: 250, prepTimeMinutes: 1, locationIds: [], modifierGroups: [] })})`;
  });
  const before = await schema();
  const [{ rows0 }] =
    await sql`select count(*)::int rows0 from public.pos_pending_resolution_reasons`;
  check("1. fixture: organization with owner, ownerless organization, platform admin", true);

  // ---- 2. rollback 0035 then 0034, one transaction
  await sql.begin(async (tx) => {
    await tx.unsafe(ROLLBACK_0036);
    await tx.unsafe(ROLLBACK_0035);
    await tx.unsafe(ROLLBACK_0034);
  });
  check("2. 0036-, 0035- and 0034-rollback.sql applied in one transaction", true);
  {
    const v = await legacyCallable();
    check(
      "2. 0036 rolled back: the three basis-point sale RPCs are callable by authenticated again, never by anon or service_role",
      v ===
        "create_pos_sale:true:false,finalize_pos_sale_atomic:true:false,persist_finalized_pos_sale_atomic:true:false",
      v,
    );
  }
  const assignSrc = await src("public.admin_assign_owner(uuid,text,text)");
  const resolveSrc = await src(
    "public.resolve_pending_pos_sale(uuid,uuid,text,text,integer,integer,timestamptz)",
  );
  const noop = async (sig) => {
    const s = await src(sig);
    return s !== null && !s.includes("pg_advisory_xact_lock") && !s.includes("raise exception");
  };
  check(
    "2. admin_assign_owner and admin_set_platform_role have their 0001 bodies; the three triggers stay with no-op functions (no DROP TRIGGER)",
    assignSrc &&
      !assignSrc.includes("owner_exists") &&
      !(await src("public.admin_set_platform_role(text,platform_role,boolean,text)")).includes(
        "user_ambiguous",
      ) &&
      (
        await sql`select count(*)::int n from pg_trigger
                   where tgname in ('member_owner_serialize', 'platform_role_separation', 'owner_platform_separation')`
      )[0].n === 3 &&
      (await noop("public.trg_member_owner_serialize()")) &&
      (await noop("public.trg_platform_role_separation()")) &&
      (await noop("public.trg_owner_platform_separation()")),
  );
  check(
    "2. resolve_pending_pos_sale has its 0033 body; list_pending_sale_reasons is gone",
    resolveSrc &&
      resolveSrc.includes("'reason', why") &&
      !resolveSrc.includes("pos_pending_resolution_reasons") &&
      (await src("public.list_pending_sale_reasons(uuid,uuid,text,integer)")) === null,
  );
  const [{ pol }] =
    await sql`select pg_get_expr(polqual, polrelid) pol from pg_policy where polname = 'Org managers read org audit'`;
  check(
    "2. the activity log has the 0019 policy (no store condition); the audit helper is gone",
    !pol.includes("audit_visible_location_ids") &&
      (await src("public.audit_visible_location_ids()")) === null,
    pol,
  );
  const [kept] =
    await sql`select to_regclass('public.pos_pending_resolution_reasons') is not null as tbl,
      (select count(*)::int from public.pos_pending_resolution_reasons) as rows,
      has_column_privilege('authenticated', 'public.pos_sale_key_voids', 'reason', 'select') as reason_col`;
  check(
    "2. kept: the private store and its rows; the closed keys' reason still not selectable",
    kept.tbl && kept.rows === rows0 && kept.reason_col === false,
    JSON.stringify(kept),
  );

  // ---- 3. the rolled-back window: texts stored the 0033 way
  const kRes = `${org.key}-res`;
  const kRec = `${org.key}-rec`;
  const kDir = `${org.key}-dir`;
  const r3 = await as(U.OWNER, async (c) => {
    const a = await resolve(c, kRes, TEXT.resolved);
    await sale(c, kRec);
    const b = await resolve(c, kRec, TEXT.recovered);
    return `${a}/${b}`;
  });
  await sql.unsafe(`insert into public.pos_sale_key_voids(org_id, client_order_id, location_id, actor_id, reason)
    values ('${ORG}', '${kDir}', '${STORE}', '${U.OWNER}', '${TEXT.direct}');`);
  const [w] = await sql`select
      (select reason from public.pos_sale_key_voids where client_order_id = ${kRes}) as void_text,
      (select count(*)::int from public.audit_logs where org_id = ${ORG} and metadata ? 'reason' and action like 'pos.pending_sale_%') as audit_texts`;
  check(
    "3. while rolled back, resolutions store the text in the closed key and the audit (0033 behaviour)",
    r3 === "resolved/recorded" && w.void_text === TEXT.resolved && w.audit_texts === 2,
    `${r3} ${JSON.stringify(w)}`,
  );
  const lonely = await as(U.PLAT, (c) => assign(c, ORG, `${org.key}-new@example.test`));
  check(
    "3. while rolled back, the 0001 rule is back (an owned organization accepts a second owner)",
    lonely === "ok",
    lonely,
  );
  await sql`delete from public.organization_members where org_id = ${ORG} and user_id = ${U.NEW}`;

  // ---- 4. re-apply 0034 and 0035, one transaction
  await sql.begin(async (tx) => {
    await tx.unsafe(M0034);
    await tx.unsafe(M0035);
    await tx.unsafe(M0036);
  });
  check("4. 0034, 0035 and 0036 re-applied in one transaction", true);
  {
    const v = await legacyCallable();
    check(
      "4. 0036 back: no API role can execute the three basis-point sale RPCs",
      v ===
        "create_pos_sale:false:false,finalize_pos_sale_atomic:false:false,persist_finalized_pos_sale_atomic:false:false",
      v,
    );
  }
  const moved =
    await sql`select r.client_order_id k, r.outcome, r.reason, r.order_id is not null has_order, r.location_id::text loc, r.actor_id::text actor
                            from public.pos_pending_resolution_reasons r where r.org_id = ${ORG} order by r.client_order_id`;
  const byKey = Object.fromEntries(moved.map((m) => [m.k, m]));
  check(
    "4. every text moved exactly: resolved, recovered and the direct closed key",
    moved.length === 3 &&
      byKey[kRes]?.reason === TEXT.resolved &&
      byKey[kRes].outcome === "resolved" &&
      byKey[kRes].loc === STORE &&
      byKey[kRes].actor === U.OWNER &&
      byKey[kRec]?.reason === TEXT.recovered &&
      byKey[kRec].outcome === "recovered" &&
      byKey[kRec].has_order &&
      byKey[kDir]?.reason === TEXT.direct &&
      byKey[kDir].outcome === "resolved",
    JSON.stringify(moved),
  );
  const links = await sql`select a.target k, a.metadata, r.reason
                            from public.audit_logs a left join public.pos_pending_resolution_reasons r on r.id::text = a.metadata->>'reason_id'
                           where a.org_id = ${ORG} and a.action like 'pos.pending_sale_%' order by a.target`;
  check(
    "4. each audit event links its text (reason_id, reason_length) and keeps no text",
    links.length === 2 &&
      links.every(
        (l) =>
          !("reason" in l.metadata) && l.reason && l.metadata.reason_length === l.reason.length,
      ),
    JSON.stringify(links.map((l) => l.metadata)),
  );
  const [left] =
    await sql`select (select count(*)::int from public.pos_sale_key_voids where reason <> ${MARKER}) voids,
      (select count(*)::int from public.audit_logs where org_id is not null and metadata ? 'reason' and action like 'pos.pending_sale_%') audits`;
  check(
    "4. nothing left: no closed key and no audit event holds a text",
    left.voids === 0 && left.audits === 0,
    JSON.stringify(left),
  );
  const movedAudit =
    await sql`select metadata from public.audit_logs where org_id = ${ORG} and action = 'pos.pending_reasons_moved'`;
  check(
    "4. the move is audited for the organization (2 audit events, 2 closed keys)",
    movedAudit.length === 1 &&
      movedAudit[0].metadata.audit_events === 2 &&
      movedAudit[0].metadata.closed_keys === 2,
    JSON.stringify(movedAudit),
  );
  const after = await schema();
  check(
    "4. functions, policies, triggers, privileges and constraints identical to before the rollback",
    JSON.stringify(after) === JSON.stringify(before),
    JSON.stringify(Object.keys(before).filter((k) => before[k] !== after[k])),
  );
  const late = await as(U.OWNER, (c) => sale(c, kRes).then(() => "recorded"));
  check(
    "4. the closed key still refuses the sale (sale_key_voided)",
    late === "sale_key_voided",
    late,
  );
  const owned = await as(U.PLAT, (c) => assign(c, ORG, `${org.key}-new@example.test`));
  const ownerless = await as(U.PLAT, (c) => assign(c, lone.orgId, `${org.key}-new@example.test`));
  check(
    "4. the 0034 rule is back: owned refused (owner_exists), ownerless accepted",
    owned === "owner_exists" && ownerless === "ok",
    `${owned} ${ownerless}`,
  );

  // ---- 5. idempotent
  const [n0] = await sql`select (select count(*)::int from public.pos_pending_resolution_reasons) r,
      (select count(*)::int from public.audit_logs where action = 'pos.pending_reasons_moved') m`;
  await sql.begin((tx) => tx.unsafe(M0035));
  const [n1] = await sql`select (select count(*)::int from public.pos_pending_resolution_reasons) r,
      (select count(*)::int from public.audit_logs where action = 'pos.pending_reasons_moved') m`;
  check(
    "5. 0035 again: nothing moved, nothing audited, schema unchanged",
    n0.r === n1.r && n0.m === n1.m && JSON.stringify(await schema()) === JSON.stringify(before),
    `${JSON.stringify(n0)} -> ${JSON.stringify(n1)}`,
  );

  // ---- 6. the M2 rollback first, then the 0035 rollback: the resolution RPC must NOT come back
  await sql.begin(async (tx) => {
    await tx.unsafe(M2_ROLLBACK);
    await tx.unsafe(ROLLBACK_0035);
  });
  check(
    "6. after the M2 rollback, the 0035 rollback does not recreate resolve_pending_pos_sale (owners would regain it)",
    (await src(
      "public.resolve_pending_pos_sale(uuid,uuid,text,text,integer,integer,timestamptz)",
    )) === null && (await src("public.list_pending_sale_reasons(uuid,uuid,text,integer)")) === null,
  );
  await sql.begin((tx) => tx.unsafe(M2_REAPPLY));
  check(
    "6. the M2 re-application (0031, 0032, 0033, 0035) ends exactly in the state before step 2",
    JSON.stringify(await schema()) === JSON.stringify(before),
  );
} catch (e) {
  check("script error", false, code(e));
} finally {
  try {
    await sql`delete from public.user_roles where user_id = ${U.PLAT}`;
    await sql.unsafe(dropIsolatedOrgsSql([ORG, lone.orgId]));
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([ORG, lone.orgId]).replace(/;\s*$/, "")}) x(n)`,
    );
    check("cleanup: nothing of the test organizations is left", Number(n) === 0, String(n));
  } catch (e) {
    check("cleanup", false, code(e));
  }
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
