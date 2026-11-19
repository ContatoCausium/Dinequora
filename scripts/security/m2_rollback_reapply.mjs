// M2 rollback and re-application rehearsal (docs/operations/m2-rollback). LOCAL/CI QA stack ONLY: it
// changes the schema of the database it runs on and leaves it re-applied (same functions, policies and
// triggers as after 0033 — checked), so the security suite runs it LAST.
//
//   1. fixture: an organization with an org admin (system profile), a manager granted
//      orders.resolve_pending individually, a manager on a CUSTOM profile holding it, an org admin
//      whose access to it was explicitly REVOKED, a staff member, and one closed key;
//   2. rollback.sql in ONE transaction: the M2 objects are gone, finance_read is the 0019 policy,
//      nobody holds the permission, it is stripped from every profile (custom included) and every
//      grant, revocations and closed keys are kept, the member-grant integrity of 0033 stays; sales
//      and the ledger still work;
//   3. reapply.sql in ONE transaction: functions, policies, triggers and their privileges identical to
//      the state after 0033; only the owner and the org admin on the system profile hold the
//      permission again — the custom profile, the individual grant and the revoked admin do NOT
//      (nothing reactivated silently); the closed key still refuses a sale;
//   4. reapply.sql once more: idempotent, nothing changes.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/m2_rollback_reapply.mjs
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
await assertDisposableDb(DB_URL, "test:m2-rollback-reapply").catch(exitOnRefusal);
const file = (name) =>
  fs.readFileSync(
    new URL(`../../docs/operations/m2-rollback/${name}.sql`, import.meta.url),
    "utf8",
  );

const RP = "orders.resolve_pending";
const RATE = 70000;
const U = Object.fromEntries(
  ["OWNER", "ADMIN", "ADMINR", "MGRX", "MGRC", "STAFF"].map((k) => [k, crypto.randomUUID()]),
);
const org = isolatedOrg("m2rb", {
  taxRatePpm: RATE,
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.ADMIN, role: "manager", store: true },
    { userId: U.ADMINR, role: "manager", store: true },
    { userId: U.MGRX, role: "manager", store: true },
    { userId: U.MGRC, role: "manager", store: true },
    { userId: U.STAFF, role: "staff", store: true },
  ],
});
const ORG = org.orgId;
const STORE = org.locationId;
const mid = (uid) => org.members.find((m) => m.userId === uid).memberId;

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
  } finally {
    await c.end({ timeout: 5 });
  }
}
const holders = async () => {
  const out = {};
  for (const [k, uid] of Object.entries(U))
    out[k] = await as(
      uid,
      async (c) => (await c`select public.has_permission(${ORG}, ${RP}) as ok`)[0].ok,
    );
  return out;
};
const sale = (c, key) =>
  c`select public.persist_finalized_pos_sale_atomic_v2(${ORG}, ${STORE}, 'takeout', 'Rollback test',
      _tax_rate_ppm => ${RATE}, _items => ${c.json([{ product_id: "rb-soda", quantity: 1, modifiers: [] }])},
      _client_order_id => ${key}, _payment_method => 'cash') as id`.then((r) => r[0].id);
/** Functions (body, settings, privileges), policies and triggers of schema public. */
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
      (select count(*)::int from public.pos_sale_key_voids) as closed_keys`
  )[0];
const fnExists = async (name) =>
  (
    await sql`select count(*)::int n from pg_proc where proname = ${name} and pronamespace = 'public'::regnamespace`
  )[0].n > 0;

let customProfile;
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
  const [{ id: ORG_ADMIN }] =
    await sql`select id from public.permission_profiles where is_system and key = 'org_admin'`;
  await as(U.OWNER, async (c) => {
    await c`select public.save_operational_menu(${ORG}, 'category', ${c.json({ op: "create", id: "rb-drinks", name: "Drinks" })})`;
    await c`select public.save_operational_menu(${ORG}, 'product', ${c.json({ id: "rb-soda", name: "Rollback soda", category: "rb-drinks", priceCents: 250, prepTimeMinutes: 1, locationIds: [], modifierGroups: [] })})`;
    [{ id: customProfile }] =
      await c`select public.save_permission_profile(${ORG}, null, 'Shift lead', '', 'manager',
      array['dashboard.view','pos.view','pos.sell','orders.view','orders.resolve_pending']) as id`;
    const set = (m, profile, extra, revoked) =>
      c`select public.set_member_access(${m}, 'manager', ${profile}::uuid, ${extra}::text[], ${revoked}::text[], ${[STORE]}::uuid[])`;
    await set(mid(U.ADMIN), ORG_ADMIN, [], []);
    await set(mid(U.ADMINR), ORG_ADMIN, [], [RP]);
    await set(mid(U.MGRX), null, [RP], []);
    await set(mid(U.MGRC), customProfile, [], []);
    await c`select public.resolve_pending_pos_sale(${ORG}, ${STORE}, ${`${org.key}-closed`}, 'Rollback test: never paid')`;
  });
  const h0 = await holders();
  check(
    "1. fixture: owner, org admin, individual grant and custom profile hold it; revoked admin and staff do not",
    h0.OWNER && h0.ADMIN && h0.MGRX && h0.MGRC && !h0.ADMINR && !h0.STAFF,
    JSON.stringify(h0),
  );
  const s0033 = await schema();

  // ---- 2. rollback
  await sql.begin((tx) => tx.unsafe(file("rollback")));
  check("2. rollback.sql applied in one transaction", true);
  check(
    "2. ledger_day_totals, accessible_location_ids and resolve_pending_pos_sale are gone",
    !(await fnExists("ledger_day_totals")) &&
      !(await fnExists("accessible_location_ids")) &&
      !(await fnExists("resolve_pending_pos_sale")),
  );
  const [{ pol }] =
    await sql`select pg_get_expr(polqual, polrelid) as pol from pg_policy where polname = 'finance_read'`;
  check(
    "2. finance_read is the 0019 policy again",
    /is_org_member\(org_id\) AND can_access_location\(location_id\)/.test(pol),
    pol,
  );
  const [{ src }] =
    await sql`select prosrc as src from pg_proc where proname = 'create_pos_sale_v2'`;
  check(
    "2. create_pos_sale_v2 is the 0025 body (no closed-key or isolation check)",
    !src.includes("sale_key_voided") && !src.includes("isolation_unsupported"),
  );
  const h1 = await holders();
  // has_permission is true for an owner whatever the name (owners hold everything, by design); what
  // matters is that the permission left the catalog and no other member holds it.
  const [{ inCatalog }] = await sql`select ${RP} = any(public.permission_catalog()) as "inCatalog"`;
  check(
    "2. the permission left the catalog and no member other than the owner holds it",
    inCatalog === false && Object.entries(h1).every(([k, v]) => k === "OWNER" || v === false),
    JSON.stringify(h1),
  );
  const [st] = await sql`select
      (select count(*)::int from public.permission_profiles where ${RP} = any(permissions)) as profiles,
      (select count(*)::int from public.organization_members where ${RP} = any(extra_permissions) or ${RP} = any(effective_permissions)) as members,
      (select ${RP} = any(revoked_permissions) from public.organization_members where id = ${mid(U.ADMINR)}) as revoked_kept,
      (select count(*)::int from pg_trigger where tgname = 'member_ceiling_extras') as integrity_trigger`;
  check(
    "2. stripped from every profile (system AND custom) and every grant",
    st.profiles === 0 && st.members === 0,
    JSON.stringify(st),
  );
  check(
    "2. the explicit revocation is kept; the member-grant integrity of 0033 stays",
    st.revoked_kept === true && st.integrity_trigger === 1,
  );
  check("2. closed keys are kept", (await schema()).closed_keys === s0033.closed_keys);
  const afterRb = await as(U.OWNER, async (c) => ({
    sale: await sale(c, `${org.key}-after-rollback`).then(
      (id) => typeof id === "string",
      (e) => code(e),
    ),
    ledger: (await c`select count(*)::int n from public.finance_entries where org_id = ${ORG}`)[0]
      .n,
  }));
  check(
    "2. after the rollback a sale is recorded and the ledger is readable through RLS",
    afterRb.sale === true && afterRb.ledger > 0,
    JSON.stringify(afterRb),
  );

  // ---- 3. re-application
  await sql.begin((tx) => tx.unsafe(file("reapply")));
  check("3. reapply.sql applied in one transaction", true);
  const s3 = await schema();
  check(
    "3. functions (bodies, settings, privileges), policies and triggers are identical to the state after 0033",
    s3.functions === s0033.functions &&
      s3.policies === s0033.policies &&
      s3.triggers === s0033.triggers,
  );
  const h3 = await holders();
  check(
    "3. owner and the org admin on the system profile hold it again",
    h3.OWNER && h3.ADMIN,
    JSON.stringify(h3),
  );
  check(
    "3. the custom profile, the individual grant and the revoked admin are NOT reactivated; staff never",
    !h3.MGRC && !h3.MGRX && !h3.ADMINR && !h3.STAFF,
    JSON.stringify(h3),
  );
  const [{ lists }] =
    await sql`select ${RP} = any(permissions) as lists from public.permission_profiles where id = ${customProfile}`;
  check("3. the custom profile does not list the permission", lists === false);
  const late = await as(U.OWNER, (c) =>
    sale(c, `${org.key}-closed`).then(
      () => "recorded",
      (e) => code(e),
    ),
  );
  check(
    "3. the key closed before the rollback still refuses a sale",
    late === "sale_key_voided",
    late,
  );

  // ---- 4. idempotent
  await sql.begin((tx) => tx.unsafe(file("reapply")));
  const s4 = await schema();
  check(
    "4. reapply.sql a second time changes nothing",
    JSON.stringify(s4) === JSON.stringify(s3) &&
      JSON.stringify(await holders()) === JSON.stringify(h3),
  );
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
    await sql.unsafe(dropIsolatedOrgsSql([ORG]));
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([ORG]).replace(/;\s*$/, "")}) x(n)`,
    );
    check("cleanup: nothing of the isolated organization is left", Number(n) === 0, `${n} rows`);
  } catch (e) {
    check("cleanup", false, code(e));
  }
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok);
console.log(
  `M2 rollback and re-application: ${results.length - failed.length}/${results.length} passed`,
);
if (failed.length) process.exit(1);
