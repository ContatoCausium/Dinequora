// What the API roles can do in schema public, checked explicitly. LOCAL/CI QA stack ONLY (read-only).
//
// Two privilege models exist (docs/operations/privilege-models.md):
//   hosted  projects created since 2026 (Client Preview, production): role postgres has NO default
//           privileges for the API roles, so only the explicit GRANTs of the migrations count (plus
//           PUBLIC's built-in EXECUTE on functions, which a migration must revoke by name).
//           scripts/qa/hosted-default-privileges.sql puts a disposable stack in this model.
//   cli     a stack started by the Supabase CLI (and older hosted projects): anon, authenticated and
//           service_role get every privilege on everything postgres creates, unless a migration
//           revokes it; access then rests on RLS and on the functions' own checks.
// The model is read from the database itself (pg_default_acl), never assumed.
//
// hosted model: the effective privileges of anon, authenticated and service_role on every table,
//   column, function and sequence of schema public must be EXACTLY scripts/qa/api-privileges.hosted.json
//   (the contract: a new or lost privilege fails until the manifest is regenerated and reviewed), and
//   the invariants below hold whatever the manifest says.
// cli model: every privilege of the manifest must be present (the explicit grants do not depend on
//   the model), the invariants that explicit REVOKEs guarantee hold, and the extra privileges this
//   model adds are counted and printed (they are why a test passing here proves less).
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/api_privileges.mjs [--expect hosted|cli]
//   ... --write        regenerate the manifest (hosted model only; review the diff)
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertDisposableDb, exitOnRefusal } from "../guard/target-guard.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const postgres = require("postgres");

const DB_URL = process.env.QA_DB_URL ?? process.env.DB_URL;
await assertDisposableDb(DB_URL, "test:api-privileges").catch(exitOnRefusal);
const MANIFEST = fileURLToPath(new URL("../qa/api-privileges.hosted.json", import.meta.url));
const WRITE = process.argv.includes("--write");
const expectIdx = process.argv.indexOf("--expect");
const EXPECT = expectIdx > 0 ? process.argv[expectIdx + 1] : null;
const ROLES = ["anon", "authenticated", "service_role"];

// Functions no API role may execute: retired by 0036, trigger functions, internal helpers.
const NEVER_EXECUTABLE = [
  "create_pos_sale(",
  "finalize_pos_sale_atomic(",
  "persist_finalized_pos_sale_atomic(",
];
// The functions anon can execute in the hosted model (see invariant I8).
const ANON_EXECUTABLE = [
  "active_store_count",
  "assert_org_operational",
  "can_manage_member",
  "can_manage_org",
  "can_operate_location",
  "get_invitation",
  "handle_new_user",
  "has_platform_role",
  "is_org_member",
  "is_org_owner",
  "org_is_operational",
  "permission_catalog",
  "role_ceiling",
  "role_default_permissions",
  "shares_org_with",
  "trg_invitations_audit",
  "trg_members_audit",
  "trg_subscription_sync",
];
// Tables whose rows are never read through the API by signed-in users (no SELECT in the hosted model).
const NEVER_SELECTABLE = [
  "pos_pending_resolution_reasons",
  "stripe_webhook_events",
  "platform_bootstrap",
];

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

let actual;
let model;
try {
  actual = await sql.begin("read only", async (tx) => {
    await tx.unsafe("set local search_path = pg_catalog"); // schema-qualified type names in signatures
    const acl =
      await tx`select d.defaclobjtype::text as kind, array_to_string(d.defaclacl, ',') as acl
                           from pg_default_acl d where d.defaclnamespace = 'public'::regnamespace and d.defaclrole = 'postgres'::regrole order by 1`;
    const tables = await tx`
      select c.relname as name, r.role,
             array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
                                    where has_table_privilege(r.role, c.oid, p)), ',') as privileges,
             -- column-level privileges, where the table-level one is absent (a column GRANT is a grant too)
             array_to_string(array(select a.attname::text || ':' || p
                                     from pg_attribute a, unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
                                    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                                      and not has_table_privilege(r.role, c.oid, p)
                                      and has_column_privilege(r.role, c.oid, a.attnum, p) order by a.attnum, p), ',') as column_privileges
        from pg_class c, unnest(${ROLES}::text[]) r(role)
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') order by 1, 2`;
    const schema = await tx`
      select r.role, array_to_string(array(select p from unnest(array['USAGE','CREATE']) p
                                            where has_schema_privilege(r.role, 'public'::regnamespace, p)), ',') as privileges
        from unnest(${ROLES}::text[]) r(role) order by 1`;
    const functions = await tx`
      select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
             array_to_string(array(select r from unnest(${ROLES}::text[]) r where has_function_privilege(r, p.oid, 'EXECUTE')), ',') as roles
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`;
    const sequences = await tx`
      select c.relname as name, r.role,
             array_to_string(array(select p from unnest(array['USAGE','SELECT','UPDATE']) p where has_sequence_privilege(r.role, c.oid, p)), ',') as privileges
        from pg_class c, unnest(${ROLES}::text[]) r(role)
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' order by 1, 2`;
    return { acl, tables, schema, functions, sequences };
  });
} finally {
  await sql.end({ timeout: 5 });
}
const aclOf = (kind) => actual.acl.find((a) => a.kind === kind)?.acl ?? "";
model =
  /(^|,)authenticated=/.test(aclOf("f")) || /(^|,)authenticated=a/.test(aclOf("r"))
    ? "cli"
    : "hosted";
console.log(
  `privilege model of this database: ${model} (default privileges of role postgres in schema public)`,
);
if (EXPECT) check(`the database is in the expected model (${EXPECT})`, model === EXPECT, model);

// One flat, sorted list of "kind|object|role|privilege" entries: easy to diff, easy to review.
const flat = [];
for (const t of actual.tables) {
  for (const p of t.privileges.split(",").filter(Boolean))
    flat.push(`table|${t.name}|${t.role}|${p}`);
  for (const cp of t.column_privileges.split(",").filter(Boolean)) {
    const [column, privilege] = cp.split(":");
    flat.push(`column|${t.name}.${column}|${t.role}|${privilege}`);
  }
}
for (const s of actual.schema)
  for (const p of s.privileges.split(",").filter(Boolean))
    flat.push(`schema|public|${s.role}|${p}`);
for (const f of actual.functions)
  for (const r of f.roles.split(",").filter(Boolean)) flat.push(`function|${f.name}|${r}|EXECUTE`);
for (const s of actual.sequences)
  for (const p of s.privileges.split(",").filter(Boolean))
    flat.push(`sequence|${s.name}|${s.role}|${p}`);
flat.sort();
const defaultAcl = Object.fromEntries(actual.acl.map((a) => [a.kind, a.acl]));

if (WRITE) {
  if (model !== "hosted") {
    console.error("refused: the manifest is written from a database in the hosted model only");
    process.exit(2);
  }
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        note: "Effective privileges of anon, authenticated and service_role in schema public under the HOSTED privilege model, after every migration. GENERATED by scripts/security/api_privileges.mjs --write; review every change of this file like a GRANT.",
        defaultPrivilegesOfPostgres: defaultAcl,
        privileges: flat,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${flat.length} privileges to scripts/qa/api-privileges.hosted.json`);
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
/** Key-sorted JSON: the comparison does not depend on the order the database returned the rows in. */
const sorted = (o) =>
  JSON.stringify(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
const expected = new Set(manifest.privileges);
const have = new Set(flat);
const missing = [...expected].filter((x) => !have.has(x));
const extra = [...have].filter((x) => !expected.has(x));
const by = (list) => {
  const m = {};
  for (const x of list) {
    const [kind, , role] = x.split("|");
    m[`${role} ${kind}`] = (m[`${role} ${kind}`] ?? 0) + 1;
  }
  return JSON.stringify(m);
};

if (model === "hosted") {
  check(
    "H1 the default privileges of role postgres are the hosted ones (nothing for the API roles but TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on tables)",
    sorted(defaultAcl) === sorted(manifest.defaultPrivilegesOfPostgres),
    JSON.stringify(defaultAcl),
  );
  check(
    `H2 the effective privileges are exactly the manifest (${expected.size} entries): nothing missing, nothing extra`,
    missing.length === 0 && extra.length === 0,
    `missing ${missing.length}${missing.length ? `: ${missing.slice(0, 5).join(" ; ")}` : ""}; extra ${extra.length}${extra.length ? `: ${extra.slice(0, 5).join(" ; ")}` : ""}`,
  );
} else {
  check(
    "C1 the default privileges of role postgres are the CLI ones (the API roles get everything postgres creates)",
    /authenticated=X/.test(aclOf("f")) && /authenticated=arwdDxtm/.test(aclOf("r")),
    JSON.stringify(defaultAcl),
  );
  check(
    `C2 every privilege of the hosted manifest is present here too (${expected.size} entries): the explicit grants do not depend on the model`,
    missing.length === 0,
    `missing ${missing.length}${missing.length ? `: ${missing.slice(0, 5).join(" ; ")}` : ""}`,
  );
  console.log(
    `INFO this model adds ${extra.length} privileges that a hosted project does not have: ${by(extra)}`,
  );
  console.log(
    "INFO here access rests on RLS and on the functions' own checks; the hosted model also refuses at the privilege level",
  );
}

// ---- invariants (both models where an explicit REVOKE guarantees them; hosted where only the model does)
const has = (kind, object, role, priv) => have.has(`${kind}|${object}|${role}|${priv}`);
const fnExists = (prefix) => actual.functions.some((x) => x.name.startsWith(prefix));
const fnExec = (prefix, role) =>
  flat.some((x) => x.startsWith(`function|${prefix}`) && x.endsWith(`|${role}|EXECUTE`));
check(
  "I1 the retired sale RPCs (0036) exist and are executable by no API role",
  NEVER_EXECUTABLE.every((f) => fnExists(f) && ROLES.every((r) => !fnExec(f, r))),
);
// Revoked from public, anon and authenticated by 0033/0034. service_role is not an API caller of
// triggers and keeps the CLI default in the cli model; in the hosted model it has nothing either.
const SECURITY_TRIGGERS = [
  "trg_member_grant_integrity(",
  "trg_member_owner_serialize(",
  "trg_platform_role_separation(",
  "trg_owner_platform_separation(",
];
const triggerRoles = model === "hosted" ? ROLES : ["anon", "authenticated"];
check(
  `I2 the trigger functions of the security migrations exist and are executable by none of: ${triggerRoles.join(", ")}`,
  SECURITY_TRIGGERS.every((f) => fnExists(f) && triggerRoles.every((r) => !fnExec(f, r))),
  SECURITY_TRIGGERS.filter((f) => !fnExists(f) || triggerRoles.some((r) => fnExec(f, r))).join(
    " ; ",
  ),
);
check(
  "I3 the private store of justifications has no API privilege at all; the closed keys expose four columns to authenticated, nothing to anon",
  ROLES.filter((r) => r !== "service_role").every(
    (r) =>
      !flat.some(
        (x) =>
          x.startsWith(`table|pos_pending_resolution_reasons|${r}|`) ||
          (x.startsWith(`column|pos_pending_resolution_reasons.`) && x.includes(`|${r}|`)),
      ),
  ) &&
    !has("table", "pos_sale_key_voids", "authenticated", "SELECT") &&
    ["org_id", "client_order_id", "location_id", "created_at"].every((c) =>
      has("column", `pos_sale_key_voids.${c}`, "authenticated", "SELECT"),
    ) &&
    !flat.some(
      (x) =>
        x.startsWith("column|pos_sale_key_voids.") &&
        x.includes("|authenticated|") &&
        !/^column\|pos_sale_key_voids\.(org_id|client_order_id|location_id|created_at)\|authenticated\|SELECT$/.test(
          x,
        ),
    ) &&
    !flat.some((x) => x.startsWith("column|pos_sale_key_voids.") && x.includes("|anon|")),
);
const SALE_FLOW = [
  "create_pos_sale_v2(",
  "finalize_pos_sale_atomic_v2(",
  "persist_finalized_pos_sale_atomic_v2(",
  "resolve_pending_pos_sale(",
  "list_pending_sale_reasons(",
];
check(
  "I4 the current sale flow exists, is executable by authenticated and never by anon",
  SALE_FLOW.every((f) => fnExists(f) && fnExec(f, "authenticated") && !fnExec(f, "anon")),
);
if (model === "hosted") {
  const anonData = flat.filter(
    (x) => /^(table|column)\|/.test(x) && /\|anon\|(SELECT|INSERT|UPDATE|DELETE)$/.test(x),
  );
  check(
    "I5 hosted: anon reads and writes no table and no column of schema public",
    anonData.length === 0,
    anonData.slice(0, 5).join(" ; "),
  );
  // table-level AND column-level: a column GRANT is a direct write too
  const authWrites = flat.filter(
    (x) => /^(table|column)\|/.test(x) && /\|authenticated\|(INSERT|UPDATE|DELETE)$/.test(x),
  );
  // The one direct write: a signed-in user updates the own profile row (0000, RLS: id = auth.uid()).
  const DIRECT_WRITES = ["table|profiles|authenticated|UPDATE"];
  check(
    "I6 hosted: the only direct write of authenticated (table or column) is UPDATE on profiles (own row, RLS); every other write goes through an RPC",
    JSON.stringify(authWrites) === JSON.stringify(DIRECT_WRITES),
    authWrites.slice(0, 8).join(" ; "),
  );
  check(
    "I7 hosted: authenticated cannot select the tables that are never read through the API",
    NEVER_SELECTABLE.every(
      (t) =>
        !has("table", t, "authenticated", "SELECT") &&
        !flat.some((x) => x.startsWith(`column|${t}.`) && x.includes("|authenticated|")),
    ),
  );
  // What anon may execute is a closed list (PUBLIC keeps EXECUTE on functions unless a migration revokes
  // it): predicates keyed on auth.uid(), static catalog data, the invitation lookup and trigger
  // functions (not callable directly). A new entry is a decision, not a side effect.
  const anonFns = flat
    .filter((x) => x.startsWith("function|") && x.endsWith("|anon|EXECUTE"))
    .map((x) => x.split("|")[1].split("(")[0]);
  const unexpected = anonFns.filter((f) => !ANON_EXECUTABLE.includes(f));
  check(
    `I8 hosted: anon executes only the ${ANON_EXECUTABLE.length} listed functions (none writes data)`,
    unexpected.length === 0,
    unexpected.join(", "),
  );
  check(
    "I9 hosted: the API roles use schema public (USAGE) and none can create objects in it",
    ROLES.every(
      (r) => has("schema", "public", r, "USAGE") && !has("schema", "public", r, "CREATE"),
    ),
  );
  const platform = flat.filter(
    (x) =>
      /^table\|/.test(x) &&
      /\|(anon|authenticated)\|(TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)$/.test(x),
  ).length;
  console.log(
    `INFO hosted: ${platform} TRUNCATE/REFERENCES/TRIGGER/MAINTAIN table privileges of anon/authenticated come from the platform's default (not reachable through PostgREST; listed in the manifest; docs/operations/privilege-models.md)`,
  );
}
const failed = results.filter((r) => !r).length;
console.log(`API privileges (${model} model): ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
