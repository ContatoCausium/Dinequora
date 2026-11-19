// Member grant integrity (migration 0033, finding M1). LOCAL/CI QA stack ONLY.
//
// Real PostgreSQL sessions impersonate members (request.jwt.claim.sub + role authenticated) and
// call the team RPCs directly — exactly what a crafted API request would do — to prove that:
//   legitimate  owners grant any permission the tier can hold (orders.resolve_pending to a manager
//               included); a manager grants staff only what the manager holds; an organization admin
//               (manager tier, org_admin profile) likewise; a manager invites staff with a profile it
//               fully holds; a promotion keeps grants that were valid before;
//   refused     a grant outside the member's tier, for every caller, owners included (staff never
//               hold orders.resolve_pending, not even inert: permission_outside_role); a manager
//               granting or inviting with permissions it does not hold (permission_exceeds_own);
//               managers acting on managers, on themselves or outside their stores; staff managing
//               anyone; another tenant's member, profile or organization; a platform admin that is
//               not a member; direct writes to organization_members through the API role;
//   indirect    a demotion drops the grants the lower tier cannot hold (audited), so a later
//               promotion reactivates nothing; a direct service-role write cannot store an inert
//               grant either (trigger, audited).
// Every refusal is checked to have changed nothing. Isolation: two own organizations, synthetic
// users and one platform-admin role row, all removed at the end.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/member_grant_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:member-grant-integrity").catch(exitOnRefusal);

const RP = "orders.resolve_pending";
const U = Object.fromEntries(
  [
    "OWNER",
    "ADMINP",
    "MGR",
    "MGRR",
    "MGR2",
    "STAFF",
    "STAFF2",
    "STAFF3",
    "STAFFS2",
    "OWNERB",
    "STAFFB",
    "PLAT",
    "ADMIN2",
    "STAFFX",
    "STAFFINV",
  ].map((k) => [k, crypto.randomUUID()]),
);
const A = isolatedOrg("grants", {
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.ADMINP, role: "manager", store: true },
    { userId: U.MGR, role: "manager", store: true },
    { userId: U.MGRR, role: "manager", store: true },
    { userId: U.MGR2, role: "manager", store: true },
    { userId: U.STAFF, role: "staff", store: true },
    { userId: U.STAFF2, role: "staff", store: true },
    { userId: U.STAFF3, role: "staff", store: true },
    { userId: U.STAFFS2, role: "staff" },
    { userId: U.ADMIN2, role: "manager", store: true },
    { userId: U.STAFFX, role: "staff", store: true },
  ],
});
const B = isolatedOrg("grantsb", {
  members: [
    { userId: U.OWNERB, role: "owner" },
    { userId: U.STAFFB, role: "staff", store: true },
  ],
});
const S1 = A.locationId;
const S2 = crypto.randomUUID();
const mid = (org, uid) => org.members.find((m) => m.userId === uid).memberId;

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const code = (e) => String(e?.message ?? e).split("\n")[0];

async function session(userId, role = "authenticated") {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  await c`select set_config('request.jwt.claim.sub', ${userId}, false)`;
  await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role })}, false)`;
  await c.unsafe(`set role ${role}`);
  return c;
}
/** Runs fn(c) as `uid`; returns "ok" or the error code. */
async function as(uid, fn, role = "authenticated") {
  const c = await session(uid, role);
  try {
    await fn(c);
    return "ok";
  } catch (e) {
    return code(e);
  } finally {
    await c.end({ timeout: 5 });
  }
}
const access = (c, memberId, role, profile, extra, locs = [S1]) =>
  c`select public.set_member_access(${memberId}, ${role}::public.org_role, ${profile}::uuid, ${extra}::text[], '{}'::text[], ${locs}::uuid[])`;
const invite = (c, org, email, role, profile, locs = [S1]) =>
  c`select public.create_invitation(${org}, ${email}, ${role}::public.org_role, ${locs}::uuid[], ${profile}::uuid)`;
const member = async (memberId) =>
  (
    await sql`select role, profile_id, extra_permissions as extra, effective_permissions as eff
               from public.organization_members where id = ${memberId}`
  )[0];
const has = async (uid, org, perm) => {
  const c = await session(uid);
  try {
    return (await c`select public.has_permission(${org}, ${perm}) as ok`)[0].ok;
  } finally {
    await c.end({ timeout: 5 });
  }
};
const invitations = async (org) =>
  (await sql`select count(*)::int n from public.invitations where org_id = ${org}`)[0].n;
const audit = (org, action, target) =>
  sql`select metadata from public.audit_logs where org_id = ${org} and action = ${action} and target = ${target} order by created_at, id`;
/** A refusal must change nothing: same member row, same invitations. */
async function refused(name, expected, uid, fn, watch, org = A.orgId) {
  const before = JSON.stringify(await member(watch));
  const inv = await invitations(org);
  const r = await as(uid, fn);
  const same = JSON.stringify(await member(watch)) === before && (await invitations(org)) === inv;
  check(name, r === expected && same, `${r}${same ? "" : " — STATE CHANGED"}`);
}

try {
  // ---------------------------------------------------------------- fixture
  await sql.unsafe(
    createTestUsersSql(
      Object.entries(U).map(([k, id]) => ({
        userId: id,
        email: `${A.key}-${k.toLowerCase()}@example.test`,
      })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql.unsafe(`begin;
    insert into public.locations(id, org_id, slug, name, address) values ('${S2}', '${A.orgId}', 't_${A.key}_s2', 'Second ${A.key}', '2 Test Street');
    insert into public.member_location_access(member_id, location_id) values ('${mid(A, U.STAFFS2)}', '${S2}');
    insert into public.user_roles(user_id, role) values ('${U.PLAT}', 'platform_admin');
    commit;`);
  const [{ id: ORG_ADMIN }] =
    await sql`select id from public.permission_profiles where is_system and key = 'org_admin'`;
  const [{ id: CASHIER }] =
    await sql`select id from public.permission_profiles where is_system and key = 'cashier'`;
  const [{ id: FINANCE }] =
    await sql`select id from public.permission_profiles where is_system and key = 'finance'`;
  let RESTRICTED;
  let PROFILE_A;
  {
    const c = await session(U.OWNER);
    [{ id: RESTRICTED }] =
      await c`select public.save_permission_profile(${A.orgId}, null, 'Restricted manager', '', 'manager',
      array['dashboard.view','pos.view','pos.sell','orders.view','team.view','team.manage','team.invite']) as id`;
    [{ id: PROFILE_A }] =
      await c`select public.save_permission_profile(${A.orgId}, null, 'Org A staff', '', 'staff',
      array['dashboard.view','pos.view']) as id`;
    await access(c, mid(A, U.ADMINP), "manager", ORG_ADMIN, []);
    await access(c, mid(A, U.MGRR), "manager", RESTRICTED, []);
    await access(c, mid(A, U.ADMIN2), "manager", ORG_ADMIN, []);
    await access(c, mid(A, U.STAFFX), "staff", CASHIER, ["inventory.adjust"]);
    await c.end({ timeout: 5 });
  }
  check(
    "fixture: two organizations, 2 stores, org admin, restricted manager, staff, platform admin",
    true,
  );

  // ---------------------------------------------------------------- legitimate
  check(
    "L1 owner grants orders.resolve_pending to a manager",
    (await as(U.OWNER, (c) => access(c, mid(A, U.MGR), "manager", null, [RP]))) === "ok" &&
      (await has(U.MGR, A.orgId, RP)),
  );
  check(
    "L1 the grant is audited (member.access_changed lists it)",
    (await audit(A.orgId, "member.access_changed", U.MGR)).some((a) =>
      (a.metadata.granted ?? []).includes(RP),
    ),
  );
  check(
    "L2 owner grants staff a permission the staff tier can hold",
    (await as(U.OWNER, (c) => access(c, mid(A, U.STAFF2), "staff", null, ["inventory.adjust"]))) ===
      "ok" && (await has(U.STAFF2, A.orgId, "inventory.adjust")),
  );
  check(
    "L3 manager grants staff a permission the manager holds",
    (await as(U.MGR, (c) => access(c, mid(A, U.STAFF), "staff", null, ["inventory.adjust"]))) ===
      "ok" && (await has(U.STAFF, A.orgId, "inventory.adjust")),
  );
  check(
    "L4 organization admin grants staff a permission it holds",
    (await as(U.ADMINP, (c) => access(c, mid(A, U.STAFF3), "staff", null, ["reports.view"]))) ===
      "ok" && (await has(U.STAFF3, A.orgId, "reports.view")),
  );
  {
    const n = await invitations(A.orgId);
    const r = await as(U.MGR, (c) =>
      invite(c, A.orgId, `${A.key}-inv1@example.test`, "staff", CASHIER),
    );
    check(
      "L5 manager invites staff with a profile it fully holds (cashier)",
      r === "ok" && (await invitations(A.orgId)) === n + 1,
      r,
    );
  }
  check(
    "L6 owner gives a manager orders.resolve_pending while promoting a staff member (set_member_access)",
    (await as(U.OWNER, (c) =>
      access(c, mid(A, U.STAFF3), "manager", null, [RP, "reports.view"]),
    )) === "ok" && (await has(U.STAFF3, A.orgId, RP)),
  );

  // ---------------------------------------------------------------- refused (direct RPC calls)
  await refused(
    "N1 manager WITHOUT the permission plants orders.resolve_pending in staff extras",
    "permission_outside_role",
    U.MGR2,
    (c) => access(c, mid(A, U.STAFF), "staff", null, ["inventory.adjust", RP]),
    mid(A, U.STAFF),
  );
  await refused(
    "N2 organization admin (holds it) plants it in staff extras",
    "permission_outside_role",
    U.ADMINP,
    (c) => access(c, mid(A, U.STAFF), "staff", null, [RP]),
    mid(A, U.STAFF),
  );
  await refused(
    "N3 owner plants it in staff extras (staff never, not even inert)",
    "permission_outside_role",
    U.OWNER,
    (c) => access(c, mid(A, U.STAFF), "staff", null, [RP]),
    mid(A, U.STAFF),
  );
  await refused(
    "N3b owner grants staff a team permission (outside the staff tier)",
    "permission_outside_role",
    U.OWNER,
    (c) => access(c, mid(A, U.STAFF), "staff", null, ["team.manage"]),
    mid(A, U.STAFF),
  );
  await refused(
    "N4 restricted manager grants staff a permission it does not hold (finance.view)",
    "permission_exceeds_own",
    U.MGRR,
    (c) => access(c, mid(A, U.STAFF), "staff", null, ["finance.view"]),
    mid(A, U.STAFF),
  );
  await refused(
    "N4b restricted manager assigns staff a profile beyond its own (finance)",
    "permission_exceeds_own",
    U.MGRR,
    (c) => access(c, mid(A, U.STAFF), "staff", FINANCE, []),
    mid(A, U.STAFF),
  );
  await refused(
    "N5 restricted manager invites staff with a profile beyond its own (finance)",
    "permission_exceeds_own",
    U.MGRR,
    (c) => invite(c, A.orgId, `${A.key}-inv2@example.test`, "staff", FINANCE),
    mid(A, U.STAFF),
  );
  await refused(
    "N5b restricted manager invites staff with the tier defaults (beyond its own)",
    "permission_exceeds_own",
    U.MGRR,
    (c) => invite(c, A.orgId, `${A.key}-inv3@example.test`, "staff", null),
    mid(A, U.STAFF),
  );
  await refused(
    "N5c manager invites a manager",
    "forbidden",
    U.MGR,
    (c) => invite(c, A.orgId, `${A.key}-inv4@example.test`, "manager", null),
    mid(A, U.STAFF),
  );
  await refused(
    "N6 manager changes another manager's access",
    "forbidden",
    U.MGR,
    (c) => access(c, mid(A, U.MGR2), "manager", null, [RP]),
    mid(A, U.MGR2),
  );
  await refused(
    "N6b organization admin grants orders.resolve_pending to a manager (only owners manage managers)",
    "forbidden",
    U.ADMINP,
    (c) => access(c, mid(A, U.MGR2), "manager", null, [RP]),
    mid(A, U.MGR2),
  );
  await refused(
    "N7 manager changes its own access",
    "forbidden",
    U.MGR2,
    (c) => access(c, mid(A, U.MGR2), "manager", null, [RP]),
    mid(A, U.MGR2),
  );
  await refused(
    "N8 staff changes another staff member's access",
    "forbidden",
    U.STAFF2,
    (c) => access(c, mid(A, U.STAFF), "staff", null, ["inventory.adjust"]),
    mid(A, U.STAFF),
  );
  await refused(
    "N8b staff invites someone",
    "forbidden",
    U.STAFF2,
    (c) => invite(c, A.orgId, `${A.key}-inv5@example.test`, "staff", null),
    mid(A, U.STAFF),
  );
  await refused(
    "N9 manager changes staff of a store outside its own",
    "forbidden",
    U.MGR,
    (c) => access(c, mid(A, U.STAFFS2), "staff", null, ["inventory.adjust"], [S2]),
    mid(A, U.STAFFS2),
  );
  await refused(
    "N10 manager of A changes a member of B",
    "forbidden",
    U.MGR,
    (c) => access(c, mid(B, U.STAFFB), "staff", null, ["inventory.adjust"], [B.locationId]),
    mid(B, U.STAFFB),
    B.orgId,
  );
  await refused(
    "N10b owner of A changes a member of B",
    "forbidden",
    U.OWNER,
    (c) => access(c, mid(B, U.STAFFB), "staff", null, ["inventory.adjust"], [B.locationId]),
    mid(B, U.STAFFB),
    B.orgId,
  );
  await refused(
    "N10c owner of B assigns a profile of A",
    "invalid_profile",
    U.OWNERB,
    (c) => access(c, mid(B, U.STAFFB), "staff", PROFILE_A, [], [B.locationId]),
    mid(B, U.STAFFB),
    B.orgId,
  );
  await refused(
    "N10d owner of A invites into B",
    "forbidden",
    U.OWNER,
    (c) => invite(c, B.orgId, `${A.key}-inv6@example.test`, "staff", null, [B.locationId]),
    mid(B, U.STAFFB),
    B.orgId,
  );
  await refused(
    "N10e owner of B grants a store of A",
    "invalid_location",
    U.OWNERB,
    (c) => access(c, mid(B, U.STAFFB), "staff", null, [], [S1]),
    mid(B, U.STAFFB),
    B.orgId,
  );
  check(
    "N11 platform admin (not a member) does not hold orders.resolve_pending",
    !(await has(U.PLAT, A.orgId, RP)),
  );
  await refused(
    "N11b platform admin changes a member's access",
    "forbidden",
    U.PLAT,
    (c) => access(c, mid(A, U.STAFF), "staff", null, ["inventory.adjust"]),
    mid(A, U.STAFF),
  );
  {
    const r = await as(
      U.PLAT,
      (c) =>
        c`select public.resolve_pending_pos_sale(${A.orgId}, ${S1}, ${`${A.key}-k`}, 'Platform admin probe text')`,
    );
    check("N11c platform admin resolves a pending sale", r === "forbidden", r);
  }
  {
    const before = JSON.stringify(await member(mid(A, U.STAFF)));
    const r = await as(
      U.MGR,
      (c) =>
        c`update public.organization_members set extra_permissions = ${[RP]}::text[] where id = ${mid(A, U.STAFF)}`,
    );
    check(
      "N12 direct table write through the API role changes nothing",
      JSON.stringify(await member(mid(A, U.STAFF))) === before,
      r,
    );
  }
  await refused(
    "N13 manager assigns staff a manager-tier profile",
    "profile_tier_mismatch",
    U.MGR,
    (c) => access(c, mid(A, U.STAFF), "staff", ORG_ADMIN, []),
    mid(A, U.STAFF),
  );
  {
    const r = await as(
      U.MGR,
      (c) =>
        c`select public.save_permission_profile(${A.orgId}, null, 'Sneaky', '', 'staff', array['pos.view'])`,
    );
    check("N13b manager creates a permission profile", r === "forbidden", r);
  }

  // ---------------------------------------------------------------- indirect escalation
  {
    // MGR holds orders.resolve_pending (L1). Demotion drops it; promotion does not bring it back.
    const r1 = await as(
      U.OWNER,
      (c) => c`select public.set_member_role(${mid(A, U.MGR)}, 'staff')`,
    );
    const demoted = await member(mid(A, U.MGR));
    const pruned = await audit(A.orgId, "member.extras_pruned", U.MGR);
    check(
      "I1 demotion to staff drops the grants the staff tier cannot hold",
      r1 === "ok" && !demoted.extra.includes(RP),
      JSON.stringify(demoted.extra),
    );
    check(
      "I1 the dropped grants are audited (member.extras_pruned)",
      pruned.length === 1 && pruned[0].metadata.removed.includes(RP),
      JSON.stringify(pruned.map((p) => p.metadata)),
    );
    const r2 = await as(
      U.OWNER,
      (c) => c`select public.set_member_role(${mid(A, U.MGR)}, 'manager')`,
    );
    check(
      "I1 a later promotion reactivates nothing",
      r2 === "ok" &&
        !(await has(U.MGR, A.orgId, RP)) &&
        !(await member(mid(A, U.MGR))).extra.includes(RP),
    );
  }
  {
    const r = await as(
      U.OWNER,
      (c) => c`select public.set_member_role(${mid(A, U.STAFF2)}, 'manager')`,
    );
    const m = await member(mid(A, U.STAFF2));
    check(
      "I2 a promotion keeps the grants that were valid before (inventory.adjust)",
      r === "ok" &&
        m.extra.includes("inventory.adjust") &&
        (await audit(A.orgId, "member.extras_pruned", U.STAFF2)).length === 0,
      JSON.stringify(m.extra),
    );
  }
  {
    const r = await as(
      U.OWNER,
      (c) =>
        c`update public.organization_members set extra_permissions = ${["inventory.adjust", RP]}::text[] where id = ${mid(A, U.STAFF)}`,
      "service_role",
    );
    const m = await member(mid(A, U.STAFF));
    check(
      "I3 a direct service-role write cannot store an inert grant (trigger drops it)",
      r === "ok" && !m.extra.includes(RP) && m.extra.includes("inventory.adjust"),
      `${r} ${JSON.stringify(m.extra)}`,
    );
    check(
      "I3 and audits it",
      (await audit(A.orgId, "member.extras_pruned", U.STAFF)).some((a) =>
        a.metadata.removed.includes(RP),
      ),
    );
  }
  // ---- profiles across role changes (independent review: the profile stayed on set_member_role)
  {
    const before = JSON.stringify(await member(mid(A, U.ADMIN2)));
    const r = await as(
      U.OWNER,
      (c) => c`select public.set_member_role(${mid(A, U.ADMIN2)}, 'staff')`,
    );
    check(
      "I5 demoting an org admin to staff while it keeps the manager profile is refused (profile_tier_mismatch)",
      r === "profile_tier_mismatch" && JSON.stringify(await member(mid(A, U.ADMIN2))) === before,
      r,
    );
    const r2 = await as(U.OWNER, (c) => access(c, mid(A, U.ADMIN2), "staff", CASHIER, []));
    const r3 = await as(
      U.OWNER,
      (c) => c`select public.set_member_role(${mid(A, U.ADMIN2)}, 'manager')`,
    );
    check(
      "I6 demoted explicitly with a staff profile, a later promotion reactivates nothing of org admin",
      r2 === "ok" &&
        r3 === "ok" &&
        !(await has(U.ADMIN2, A.orgId, RP)) &&
        !(await has(U.ADMIN2, A.orgId, "team.manage")) &&
        !(await has(U.ADMIN2, A.orgId, "finance.view")),
      `${r2} ${r3}`,
    );
  }
  {
    const r1 = await as(
      U.OWNER,
      (c) => c`select public.set_member_role(${mid(A, U.STAFFX)}, 'owner')`,
    );
    const asOwner = await member(mid(A, U.STAFFX));
    const pruned = (await audit(A.orgId, "member.extras_pruned", U.STAFFX)).map((a) => a.metadata);
    check(
      "I7 becoming an owner clears the profile and the individual grants (audited)",
      r1 === "ok" &&
        asOwner.profile_id === null &&
        asOwner.extra.length === 0 &&
        pruned.some((p) => p.profile_removed === CASHIER && p.removed.includes("inventory.adjust")),
      `${r1} ${JSON.stringify(pruned)}`,
    );
    const r2 = await as(
      U.OWNER,
      (c) => c`select public.set_member_role(${mid(A, U.STAFFX)}, 'manager')`,
    );
    const m = await member(mid(A, U.STAFFX));
    check(
      "I7 demoted back to manager: tier defaults, nothing of the earlier profile or grants",
      r2 === "ok" &&
        m.profile_id === null &&
        m.extra.length === 0 &&
        !(await has(U.STAFFX, A.orgId, RP)),
      r2,
    );
  }
  {
    let token = "";
    let P = "";
    await as(U.OWNER, async (c) => {
      [{ id: P }] =
        await c`select public.save_permission_profile(${A.orgId}, null, 'Front desk', '', 'staff',
        array['dashboard.view','pos.view']) as id`;
      [{ t: token }] =
        await c`select public.create_invitation(${A.orgId}, ${`${A.key}-staffinv@example.test`},
        'staff', ${[S1]}::uuid[], ${P}) as t`;
    });
    const r = await as(
      U.OWNER,
      (c) =>
        c`select public.save_permission_profile(${A.orgId}, ${P}, 'Front desk', '', 'manager', array['dashboard.view','pos.view'])`,
    );
    check(
      "I8 a profile used by a pending invitation cannot change tier (profile_tier_in_use)",
      r === "profile_tier_in_use",
      r,
    );
    await sql`update public.permission_profiles set tier = 'manager' where id = ${P}`; // a stale invitation, forced
    const acc = await as(U.STAFFINV, (c) => c`select public.accept_invitation(${token})`);
    const [{ n }] =
      await sql`select count(*)::int n from public.organization_members where org_id = ${A.orgId} and user_id = ${U.STAFFINV}`;
    check(
      "I8 accepting an invitation as staff with a (now) manager-tier profile is refused, no member created",
      acc === "profile_tier_mismatch" && n === 0,
      acc,
    );
  }
  {
    await sql`update public.organization_members set revoked_permissions = revoked_permissions || array['legacy.removed_permission']
               where id = ${mid(A, U.STAFF2)}`;
    const r = await as(
      U.OWNER,
      (c) =>
        c`select public.set_member_access(${mid(A, U.STAFF2)}, 'manager', null, '{}'::text[], array['reports.export']::text[], ${[S1]}::uuid[])`,
    );
    const [{ rev }] =
      await sql`select revoked_permissions as rev from public.organization_members where id = ${mid(A, U.STAFF2)}`;
    check(
      "I9 a revocation of a permission no longer in the catalog survives an edit that does not send it",
      r === "ok" && rev.includes("legacy.removed_permission") && rev.includes("reports.export"),
      `${r} ${JSON.stringify(rev)}`,
    );
  }
  check(
    "I4 no staff member of either organization holds orders.resolve_pending, effective or stored",
    (
      await sql`select count(*)::int n from public.organization_members where org_id in (${A.orgId}, ${B.orgId}) and role = 'staff'
                and (${RP} = any(extra_permissions) or ${RP} = any(effective_permissions))`
    )[0].n === 0,
  );
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
    await sql`delete from public.user_roles where user_id = ${U.PLAT}`;
    await sql.unsafe(dropIsolatedOrgsSql([A.orgId, B.orgId]));
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([A.orgId, B.orgId]).replace(/;\s*$/, "")}) x(n)`,
    );
    const [{ u }] =
      await sql`select count(*)::int as u from auth.users where id = any(${Object.values(U)}::uuid[])`;
    check(
      "cleanup: nothing of the two organizations or their users is left",
      Number(n) === 0 && u === 0,
      `${n} rows, ${u} users`,
    );
  } catch (e) {
    check("cleanup", false, code(e));
  }
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok);
console.log(`Member grant integrity: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
