// Isolated organizations for database tests. LOCAL/CI QA stacks only (the callers refuse any other
// database). Each test file creates its own organization(s) and store(s) with a unique key, works
// only inside them and removes exactly what it created, so a test never depends on (or deletes)
// data of the shared QA tenant, of another test, or of a test running in parallel.
//
// The functions only build SQL; the caller runs it with psql or a postgres client as the database
// owner (the fixtures bypass RLS on purpose; the code under test still reads through RLS with a
// signed-in member).
import crypto from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuid = (v) => {
  if (!UUID.test(String(v))) throw new Error(`not a uuid: ${v}`);
  return `'${v}'::uuid`;
};
const text = (v) => `'${String(v).replace(/'/g, "''")}'`;
const KEY = /^[a-z0-9-]{1,60}$/;

/** A unique, readable key: `<label>-<time base36>-<random>`; used in slugs and names. */
export function isolationKey(label) {
  const key = `${label}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  if (!KEY.test(key)) throw new Error(`invalid isolation label: ${label}`);
  return key;
}

/**
 * Describes an isolated organization with one store. `members`: [{ userId, role, store }] where
 * `store: true` grants the member access to the store (owners see every store anyway).
 * `taxRatePpm`: the store's sales-tax rate (written directly, so no audit row), or null.
 */
export function isolatedOrg(label, { members = [], taxRatePpm = null, plan = "growth" } = {}) {
  const key = isolationKey(label);
  return {
    key,
    orgId: crypto.randomUUID(),
    locationId: crypto.randomUUID(),
    taxRatePpm,
    plan,
    members: members.map((m) => ({ ...m, memberId: crypto.randomUUID() })),
  };
}

/** One transaction: organization (active subscription), store, members and store access. */
export function createIsolatedOrgSql(org) {
  if (!KEY.test(org.key)) throw new Error("invalid key");
  const rate = org.taxRatePpm === null ? "null" : String(Math.trunc(Number(org.taxRatePpm)));
  const lines = [
    "begin;",
    `insert into public.organizations(id, slug, name, plan, status) values (${uuid(org.orgId)}, ${text(`t_${org.key}`)}, ${text(`Test ${org.key}`)}, ${text(org.plan)}, 'active');`,
    `update public.subscriptions set status = 'active' where org_id = ${uuid(org.orgId)};`,
    `insert into public.locations(id, org_id, slug, name, address, tax_rate_ppm) values (${uuid(org.locationId)}, ${uuid(org.orgId)}, ${text(`t_${org.key}_store`)}, ${text(`Store ${org.key}`)}, '1 Test Street', ${rate});`,
  ];
  for (const m of org.members) {
    if (!["owner", "manager", "staff"].includes(m.role)) throw new Error(`invalid role ${m.role}`);
    lines.push(
      `insert into public.organization_members(id, org_id, user_id, role) values (${uuid(m.memberId)}, ${uuid(org.orgId)}, ${uuid(m.userId)}, '${m.role}');`,
    );
    if (m.store)
      lines.push(
        `insert into public.member_location_access(member_id, location_id) values (${uuid(m.memberId)}, ${uuid(org.locationId)});`,
      );
  }
  lines.push("commit;");
  return lines.join("\n");
}

const ORG_TABLES = `select c.table_name::text from information_schema.columns c
    join information_schema.tables b on b.table_schema = c.table_schema and b.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'org_id' and b.table_type = 'BASE TABLE'
   order by 1`;

// Org-scoped tables that do NOT cascade from organizations: deleted explicitly, child tables first
// (retried). The cascading ones (members, stores, subscriptions, invitations, ...) go with the
// organization itself, which also lets the member trigger skip its last-owner protection.
const EXPLICIT_TABLES = `select c.table_name::text from information_schema.columns c
    join information_schema.tables b on b.table_schema = c.table_schema and b.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'org_id' and b.table_type = 'BASE TABLE'
     and not exists (select 1 from pg_constraint k
                      where k.contype = 'f' and k.conrelid = format('public.%I', c.table_name)::regclass
                        and k.confrelid = 'public.organizations'::regclass and k.confdeltype = 'c')
   order by 1`;

/**
 * One SELECT returning the number of rows, in every org-scoped table plus organizations, that belong
 * to these organizations (0 after a drop).
 */
export function countOrgRowsSql(orgIds) {
  const list = orgIds.map((id) => uuid(id).replace("::uuid", "")).join(",");
  return `select coalesce(sum((xpath('/row/c/text()', query_to_xml(format(
      'select count(*) as c from public.%I where org_id = any(%L::uuid[])', t.table_name, '{${list.replace(/'/g, "")}}'),
      false, true, '')))[1]::text::bigint), 0)
    + (select count(*) from public.organizations where id = any('{${list.replace(/'/g, "")}}'::uuid[]))
  from (${ORG_TABLES}) t;`;
}

/**
 * Removes these organizations and every row that belongs to them, and nothing else: every delete is
 * filtered by org_id (rows without org_id are reached only through rows of these organizations).
 * Tables are retried until no foreign key blocks a delete; afterwards nothing of them is left (the
 * block raises otherwise).
 */
export function dropIsolatedOrgsSql(orgIds) {
  if (!orgIds.length) return "select 1;";
  const ids = `array[${orgIds.map(uuid).join(", ")}]::uuid[]`;
  return `do $$ declare t text; failed int := 0; pass int; n bigint; begin
  delete from public.order_item_modifiers m using public.order_items i
   where m.order_item_id = i.id and i.org_id = any(${ids});
  for pass in 1..30 loop
    failed := 0;
    for t in ${EXPLICIT_TABLES} loop
      begin
        execute format('delete from public.%I where org_id = any($1)', t) using ${ids};
      exception when foreign_key_violation then failed := failed + 1;
      end;
    end loop;
    exit when failed = 0;
  end loop;
  if failed > 0 then raise exception 'isolated cleanup: % tables still referenced', failed; end if;
  delete from public.organizations where id = any(${ids});
  for t in ${ORG_TABLES} loop
    execute format('select count(*) from public.%I where org_id = any($1)', t) into n using ${ids};
    if n > 0 then raise exception 'isolated cleanup left % rows in %', n, t; end if;
  end loop;
  if exists (select 1 from public.organizations where id = any(${ids})) then
    raise exception 'isolated cleanup left an organization';
  end if;
end $$;`;
}

/** Synthetic auth users (no password, no session) for SQL-level tests that set request.jwt.claim.sub. */
export function createTestUsersSql(users) {
  return users
    .map(
      (u) =>
        `insert into auth.users(id, email, email_confirmed_at) values (${uuid(u.userId)}, ${text(u.email)}, now());`,
    )
    .join("\n");
}
export function dropTestUsersSql(userIds) {
  if (!userIds.length) return "select 1;";
  return `delete from auth.users where id = any(array[${userIds.map(uuid).join(", ")}]::uuid[]);`;
}
