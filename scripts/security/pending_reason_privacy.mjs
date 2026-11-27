// Privacy of pending-sale justifications (migration 0035). LOCAL/CI QA stack ONLY.
//
// Real PostgreSQL sessions impersonate every role (request.jwt.claim.sub + role authenticated, or
// anon) and read exactly what a crafted API request could read:
//   storage   a resolution stores the text ONLY in pos_pending_resolution_reasons; the closed key keeps
//             a NULL reason; the audit keeps structured fields plus reason_id/reason_length (never the
//             text), for both outcomes (resolved and recovered);
//   direct    nobody (owners included) can select the text through the API: not from the closed keys
//             (column privilege), not from the private store (no privilege), not from the audit
//             (moved); the closed key's structured columns stay readable where they were (the register's
//             lookup) and nowhere else; nobody can write either table;
//   rpc       list_pending_sale_reasons returns the text to the owner (every store), the organization
//             admin and a manager with an explicit grant AT THEIR STORES only; refused to a manager
//             without the permission, a manager of another store, staff (even with planted grants),
//             another tenant, a platform admin, anon, and for a store of another organization;
//   activity  the activity log (team.activity) shows a store's events only to members with access to
//             that store; organization-level events stay visible; staff see none; platform admins see
//             the structured audit only.
// Isolation: two own organizations, synthetic users and one platform-role row, all removed at the end.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/pending_reason_privacy.mjs
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
await assertDisposableDb(DB_URL, "test:pending-reason-privacy").catch(exitOnRefusal);

const RP = "orders.resolve_pending";
const RATE = 60000;
const ROLES = ["OWNER", "ADMIN", "MGRG", "MGRN", "MGR2", "CASHIER", "OWNERB", "PLAT"];
const U = Object.fromEntries(ROLES.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("reasons", {
  taxRatePpm: RATE,
  plan: "enterprise",
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.ADMIN, role: "manager", store: true },
    { userId: U.MGRG, role: "manager", store: true },
    { userId: U.MGRN, role: "manager", store: true },
    { userId: U.MGR2, role: "manager" },
    { userId: U.CASHIER, role: "staff", store: true },
  ],
});
const B = isolatedOrg("reasonsb", {
  taxRatePpm: RATE,
  members: [{ userId: U.OWNERB, role: "owner" }],
});
const S1 = A.locationId;
const S2 = crypto.randomUUID();
const PRODUCT = `rp-soda-${A.key}`;
const mid = (uid) => A.members.find((m) => m.userId === uid).memberId;
const TEXT = {
  k1: "Customer left without paying; drawer counted by the manager",
  k2: "Network lost after payment; the order was recorded",
  k3: "Card terminal rebooted; customer paid at the counter in cash",
};
const KEY = { k1: `${A.key}-k1`, k2: `${A.key}-k2`, k3: `${A.key}-k3` };

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const code = (e) => String(e?.message ?? e).split("\n")[0];

async function session(userId, role = "authenticated") {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  if (role !== "anon") {
    await c`select set_config('request.jwt.claim.sub', ${userId}, false)`;
    await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role })}, false)`;
  }
  await c.unsafe(`set role ${role}`);
  return c;
}
/** fn(c) as `who` ("ANON" = the anon role); returns its value or the error code. */
async function as(who, fn) {
  const c = await session(U[who] ?? crypto.randomUUID(), who === "ANON" ? "anon" : "authenticated");
  try {
    return await fn(c);
  } catch (e) {
    return code(e);
  } finally {
    await c.end({ timeout: 5 });
  }
}
const list = (c, org, store, key = null) =>
  c`select * from public.list_pending_sale_reasons(${org}, ${store}, ${key})`.then((r) => [...r]);
const texts = (rows) =>
  Array.isArray(rows)
    ? rows
        .map((r) => r.reason)
        .sort()
        .join(" | ")
    : rows;

try {
  // ---------------------------------------------------------------- fixture
  await sql.unsafe(
    createTestUsersSql(
      ROLES.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql.unsafe(`begin;
    insert into public.locations(id, org_id, slug, name, address, tax_rate_ppm)
      values ('${S2}', '${A.orgId}', 't_${A.key}_s2', 'Second ${A.key}', '2 Test Street', ${RATE});
    insert into public.user_roles(user_id, role) values ('${U.PLAT}', 'platform_admin');
    commit;`);
  const [{ id: ORG_ADMIN }] =
    await sql`select id from public.permission_profiles where is_system and key = 'org_admin'`;
  const [{ id: CASHIER }] =
    await sql`select id from public.permission_profiles where is_system and key = 'cashier'`;
  {
    const c = await session(U.OWNER);
    const access = (memberId, role, profile, extra, locs) =>
      c`select public.set_member_access(${memberId}, ${role}::public.org_role, ${profile}::uuid, ${extra}::text[], '{}'::text[], ${locs}::uuid[])`;
    await access(mid(U.ADMIN), "manager", ORG_ADMIN, [], [S1]);
    await access(mid(U.MGRG), "manager", null, [RP], [S1]);
    await access(mid(U.MGR2), "manager", null, [RP], [S2]);
    await access(mid(U.CASHIER), "staff", CASHIER, [], [S1]);
    await c`select public.save_operational_menu(${A.orgId}, 'category', ${c.json({ op: "create", id: `rp-drinks-${A.key}`, name: "Drinks" })})`;
    await c`select public.save_operational_menu(${A.orgId}, 'product', ${c.json({ id: PRODUCT, name: "Reason soda", category: `rp-drinks-${A.key}`, priceCents: 275, prepTimeMinutes: 1, locationIds: [], modifierGroups: [] })})`;
    // k1: no sale -> closed (store 1); k2: sale recorded -> recovered (store 1); k3: closed (store 2)
    await c`select public.resolve_pending_pos_sale(${A.orgId}, ${S1}, ${KEY.k1}, ${TEXT.k1}, 275, 2, now())`;
    await c`select public.persist_finalized_pos_sale_atomic_v2(${A.orgId}, ${S1}, 'takeout', 'Reason test',
        _tax_rate_ppm => ${RATE}, _items => ${c.json([{ product_id: PRODUCT, quantity: 1, modifiers: [] }])},
        _client_order_id => ${KEY.k2}, _payment_method => 'cash')`;
    await c`select public.resolve_pending_pos_sale(${A.orgId}, ${S1}, ${KEY.k2}, ${TEXT.k2})`;
    await c`select public.resolve_pending_pos_sale(${A.orgId}, ${S2}, ${KEY.k3}, ${TEXT.k3})`;
    await c.end({ timeout: 5 });
  }
  check(
    "fixture: 2 stores, org admin, managers with/without grant, cashier, other tenant, platform admin, 3 resolutions",
    true,
  );

  // ---------------------------------------------------------------- storage
  {
    const v =
      await sql`select client_order_id k, reason from public.pos_sale_key_voids where org_id = ${A.orgId} order by 1`;
    check(
      "S1 the closed keys (k1, k3) carry no text, only the fixed marker",
      v.length === 2 && v.every((r) => r.reason === "[moved to pos_pending_resolution_reasons]"),
      JSON.stringify(v),
    );
    const r =
      await sql`select client_order_id k, outcome, order_id is not null as has_order, reason, location_id::text loc, redacted_at
                          from public.pos_pending_resolution_reasons where org_id = ${A.orgId} order by 1`;
    check(
      "S2 the private store holds exactly the three texts, with outcome, store and order (recovered)",
      r.length === 3 &&
        r[0].reason === TEXT.k1 &&
        r[0].outcome === "resolved" &&
        !r[0].has_order &&
        r[0].loc === S1 &&
        r[1].reason === TEXT.k2 &&
        r[1].outcome === "recovered" &&
        r[1].has_order &&
        r[1].loc === S1 &&
        r[2].reason === TEXT.k3 &&
        r[2].outcome === "resolved" &&
        r[2].loc === S2 &&
        r.every((x) => x.redacted_at === null),
      JSON.stringify(r),
    );
    const a =
      await sql`select a.target k, a.action, a.metadata, r.id::text rid, length(r.reason) len
                          from public.audit_logs a
                          left join public.pos_pending_resolution_reasons r on r.id::text = a.metadata->>'reason_id'
                         where a.org_id = ${A.orgId} and a.action like 'pos.pending_sale_%' order by 1`;
    check(
      "S3 the audit keeps structured fields and the link (reason_id, reason_length), never the text",
      a.length === 3 &&
        a.every((x) => !("reason" in x.metadata) && x.rid && x.metadata.reason_length === x.len) &&
        a[0].metadata.amount_cents === 275 &&
        a[0].metadata.attempts === 2 &&
        a[1].metadata.order_id &&
        a[1].metadata.paid === true,
      JSON.stringify(a.map((x) => x.metadata)),
    );
    const anyText = await sql`select count(*)::int n from public.audit_logs
                               where org_id = ${A.orgId} and (metadata::text like ${"%" + TEXT.k1 + "%"}
                                  or metadata::text like ${"%" + TEXT.k2 + "%"} or metadata::text like ${"%" + TEXT.k3 + "%"})`;
    check("S4 no audit row of the organization contains any of the texts", anyText[0].n === 0);
  }

  // ---------------------------------------------------------------- direct API reads and writes
  for (const who of [...ROLES, "ANON"]) {
    const r1 = await as(who, (c) =>
      c`select reason from public.pos_sale_key_voids where org_id = ${A.orgId}`.then(
        (x) => x.length,
      ),
    );
    const r2 = await as(who, (c) =>
      c`select * from public.pos_sale_key_voids where org_id = ${A.orgId}`.then((x) => x.length),
    );
    const r3 = await as(who, (c) =>
      c`select reason from public.pos_pending_resolution_reasons`.then((x) => x.length),
    );
    check(
      `D1 ${who}: no text through the API (closed keys' reason, select *, private store)`,
      String(r1).startsWith("permission denied") &&
        String(r2).startsWith("permission denied") &&
        String(r3).startsWith("permission denied"),
      `${r1} / ${r2} / ${r3}`,
    );
  }
  {
    const seen = {};
    for (const who of ROLES)
      seen[who] = await as(who, (c) =>
        c`select client_order_id k from public.pos_sale_key_voids where org_id = ${A.orgId} order by 1`.then(
          (x) => x.map((r) => r.k.slice(-2)).join(","),
        ),
      );
    check(
      "D2 structured columns of closed keys: readable at the member's own stores only (RLS unchanged)",
      seen.OWNER === "k1,k3" &&
        seen.ADMIN === "k1" &&
        seen.MGRG === "k1" &&
        seen.MGRN === "k1" &&
        seen.MGR2 === "k3" &&
        seen.CASHIER === "k1" &&
        seen.OWNERB === "" &&
        seen.PLAT === "",
      JSON.stringify(seen),
    );
    const [{ ca }] =
      await sql`select (select created_at from public.pos_sale_key_voids where client_order_id = ${KEY.k1})::text ca`;
    const lookup = await as("CASHIER", (c) =>
      c`select created_at::text ca from public.pos_sale_key_voids where org_id = ${A.orgId} and client_order_id = ${KEY.k1}`.then(
        (x) => x[0]?.ca,
      ),
    );
    check(
      "D3 the register's lookup (created_at by key) still works for the cashier",
      lookup === ca,
      String(lookup),
    );
  }
  for (const who of ["OWNER", "CASHIER", "PLAT"]) {
    const ins = await as(who, (c) =>
      c`insert into public.pos_pending_resolution_reasons(org_id, location_id, client_order_id, outcome, reason) values (${A.orgId}, ${S1}, 'x', 'resolved', 'forged justification text')`.then(
        () => "ok",
      ),
    );
    const upd = await as(who, (c) =>
      c`update public.pos_sale_key_voids set reason = 'forged justification text' where org_id = ${A.orgId}`.then(
        () => "ok",
      ),
    );
    const del = await as(who, (c) =>
      c`delete from public.pos_pending_resolution_reasons where org_id = ${A.orgId}`.then(
        () => "ok",
      ),
    );
    check(
      `D4 ${who}: cannot write the private store or the closed keys' text`,
      [ins, upd, del].every((x) => String(x).startsWith("permission denied")),
      `${ins} / ${upd} / ${del}`,
    );
  }
  {
    const [{ n }] =
      await sql`select count(*)::int n from public.pos_pending_resolution_reasons where org_id = ${A.orgId}`;
    check("D4 nothing was written", n === 3);
  }

  // ---------------------------------------------------------------- RPC by role and store
  const cases = [
    ["OWNER", A.orgId, S1, `${TEXT.k1} | ${TEXT.k2}`],
    ["OWNER", A.orgId, S2, TEXT.k3],
    ["ADMIN", A.orgId, S1, `${TEXT.k1} | ${TEXT.k2}`],
    ["ADMIN", A.orgId, S2, "permission_denied"],
    ["MGRG", A.orgId, S1, `${TEXT.k1} | ${TEXT.k2}`],
    ["MGRG", A.orgId, S2, "permission_denied"],
    ["MGRN", A.orgId, S1, "permission_denied"],
    ["MGRN", A.orgId, S2, "permission_denied"],
    ["MGR2", A.orgId, S2, TEXT.k3],
    ["MGR2", A.orgId, S1, "permission_denied"],
    ["CASHIER", A.orgId, S1, "forbidden"],
    ["OWNERB", A.orgId, S1, "forbidden"],
    ["OWNERB", B.orgId, S1, "location_forbidden"],
    ["OWNER", A.orgId, B.locationId, "location_forbidden"],
    ["OWNER", A.orgId, null, "location_forbidden"],
    ["PLAT", A.orgId, S1, "forbidden"],
    ["ANON", A.orgId, S1, "permission denied for function list_pending_sale_reasons"],
  ];
  for (const [who, org, store, expected] of cases) {
    const got = texts(await as(who, (c) => list(c, org, store)));
    check(
      `R ${who} reads ${org === A.orgId ? "A" : "B"}/${store === S1 ? "S1" : store === S2 ? "S2" : "other"}: ${expected.length > 40 ? "texts" : expected}`,
      got === expected,
      got,
    );
  }
  {
    const one = await as("OWNER", (c) => list(c, A.orgId, S1, `  ${KEY.k2} `));
    check(
      "R the key filter returns that resolution only, with its structured fields",
      Array.isArray(one) &&
        one.length === 1 &&
        one[0].outcome === "recovered" &&
        one[0].order_id &&
        one[0].actor_id === U.OWNER,
      JSON.stringify(one),
    );
    const limited = await as("OWNER", (c) =>
      c`select count(*)::int n from public.list_pending_sale_reasons(${A.orgId}, ${S1}, null, 0)`.then(
        (x) => x[0].n,
      ),
    );
    check("R the limit is bounded (0 -> 1 row)", limited === 1, String(limited));
  }
  {
    // staff can never hold the permission: even planted directly (bypassing the RPCs) it is pruned, and
    // the reader refuses the staff tier anyway
    await sql`update public.organization_members set extra_permissions = array[${RP}] where id = ${mid(U.CASHIER)}`;
    const got = texts(await as("CASHIER", (c) => list(c, A.orgId, S1)));
    const [{ held }] =
      await sql`select ${RP} = any(effective_permissions) as held from public.organization_members where id = ${mid(U.CASHIER)}`;
    check(
      "R staff with a planted grant: still refused (forbidden), the grant was pruned",
      got === "forbidden" && held === false,
      `${got} ${held}`,
    );
  }

  // ---------------------------------------------------------------- activity log scoped to stores
  {
    const act = {};
    for (const who of ROLES)
      act[who] = await as(who, (c) =>
        c`select target, location_id::text loc, metadata from public.audit_logs where org_id = ${A.orgId}`.then(
          (x) => [...x],
        ),
      );
    const keys = (rows) =>
      Array.isArray(rows)
        ? rows
            .filter((r) => r.target?.startsWith(A.key))
            .map((r) => r.target.slice(-2))
            .sort()
            .join(",")
        : rows;
    check(
      "A1 pending-sale events by store: owner all; managers with team.activity only their store; staff none; other tenant none",
      keys(act.OWNER) === "k1,k2,k3" &&
        keys(act.ADMIN) === "k1,k2" &&
        keys(act.MGRN) === "k1,k2" &&
        keys(act.MGRG) === "k1,k2" &&
        keys(act.MGR2) === "k3" &&
        keys(act.CASHIER) === "" &&
        keys(act.OWNERB) === "",
      JSON.stringify(Object.fromEntries(ROLES.map((w) => [w, keys(act[w])]))),
    );
    check(
      "A2 no event of another store reaches a manager (every visible store event is at its stores)",
      act.MGRN.every((r) => r.loc === null || r.loc === S1) &&
        act.MGR2.every((r) => r.loc === null || r.loc === S2),
    );
    check(
      "A3 organization-level events (no store) stay visible to team.activity",
      act.MGRN.some((r) => r.loc === null) && act.MGR2.some((r) => r.loc === null),
    );
    check(
      "A4 the platform admin reads the structured audit of every store, never a text",
      keys(act.PLAT) === "k1,k2,k3" && act.PLAT.every((r) => !("reason" in (r.metadata ?? {}))),
      keys(act.PLAT),
    );
    check(
      "A5 nobody sees a text in any visible audit row",
      ROLES.every((w) =>
        act[w].every(
          (r) => !Object.values(TEXT).some((t) => JSON.stringify(r.metadata).includes(t)),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- objects and privileges
  {
    const [t] = await sql`select c.relrowsecurity rls,
        (select count(*)::int from pg_policy where polrelid = c.oid) policies,
        has_table_privilege('authenticated', c.oid, 'select') auth_sel, has_table_privilege('anon', c.oid, 'select') anon_sel,
        has_table_privilege('authenticated', c.oid, 'insert') auth_ins
        from pg_class c where c.oid = 'public.pos_pending_resolution_reasons'::regclass`;
    const [v] =
      await sql`select has_column_privilege('authenticated', 'public.pos_sale_key_voids', 'reason', 'select') reason_col,
        has_column_privilege('authenticated', 'public.pos_sale_key_voids', 'created_at', 'select') created_col,
        has_column_privilege('authenticated', 'public.pos_sale_key_voids', 'actor_id', 'select') actor_col,
        has_table_privilege('authenticated', 'public.pos_sale_key_voids', 'select') table_sel`;
    const [f] = await sql`select prosecdef, array_to_string(proconfig, ',') cfg,
        has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
        from pg_proc p where p.oid = 'public.list_pending_sale_reasons(uuid,uuid,text,integer)'::regprocedure`;
    check(
      "P1 private store: RLS on, no policy, no select/insert for authenticated or anon",
      t.rls && t.policies === 0 && !t.auth_sel && !t.anon_sel && !t.auth_ins,
      JSON.stringify(t),
    );
    check(
      "P2 closed keys: authenticated selects created_at but neither reason nor actor; no table-wide select",
      !v.reason_col && v.created_col && !v.actor_col && !v.table_sel,
      JSON.stringify(v),
    );
    check(
      "P3 reader: SECURITY DEFINER, fixed search_path, authenticated only",
      f.prosecdef && f.cfg.includes("search_path=public") && !f.anon && f.auth,
      JSON.stringify(f),
    );
  }
} catch (e) {
  check("script error", false, code(e));
} finally {
  try {
    await sql`delete from public.user_roles where user_id = ${U.PLAT}`;
    await sql.unsafe(dropIsolatedOrgsSql([A.orgId, B.orgId]));
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([A.orgId, B.orgId]).replace(/;\s*$/, "")}) x(n)`,
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
