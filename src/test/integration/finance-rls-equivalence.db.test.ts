// Equivalence of the finance_read policy rewritten by migration 0031 (M2) with the previous one, on
// the real database. Runs only against a DISPOSABLE stack (QA_M2_DB=1 + target guard).
//
// Two isolated organizations (A: 4 stores, B: 2 stores) with ledger rows in every store, and 13
// synthetic identities covering owner, manager (one store / all stores / financial permissions
// revoked), staff (no financial permission / finance.view / reports.view / dashboard.financials /
// a financial permission but no store), a member of both organizations, the other tenant's owner,
// a platform admin and a non-member. For EVERY identity, three sets of ledger rows must be equal:
//   intended  — the security rule written out in this test, independent of both policies;
//   previous  — the 0019 expression, evaluated with the identity (superuser session, no RLS);
//   current   — what the identity actually reads through RLS (the rewritten policy).
// Negative checks: no row of another store or another organization, by direct read or through
// ledger_day_totals with forced store ids. Everything created here is removed at the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import postgres from "postgres";
import {
  createIsolatedOrgSql,
  createTestUsersSql,
  dropIsolatedOrgsSql,
  dropTestUsersSql,
  isolatedOrg,
  type IsolatedOrg,
} from "../../../scripts/qa/isolated-org.mjs";
import { disposableQa, type QaSql } from "./qa-db";

const ENABLED = process.env["QA_M2_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";
const DB_URL = process.env["QA_DB_URL"] ?? "";
const FIN = ["finance.view", "dashboard.financials", "reports.view"];
const PREVIOUS = `public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['finance.view','dashboard.financials','reports.view']))`;

type Membership = {
  org: "A" | "B";
  role: "owner" | "manager" | "staff";
  stores: number[]; // indexes into that organization's stores
  extra?: string[];
  revoked?: string[];
};
type Identity = { label: string; userId: string; memberships: Membership[]; synthetic: boolean };

describe.skipIf(!ENABLED)(
  "finance_read rewritten (0031) = previous policy = intended rule (disposable stack)",
  { timeout: 300_000 },
  () => {
    let sql: QaSql;
    let db: ReturnType<typeof postgres>;
    let A: IsolatedOrg;
    let B: IsolatedOrg;
    const storesA: string[] = [];
    const storesB: string[] = [];
    const ids: Identity[] = [];
    const synthetic: string[] = [];
    const store = (org: "A" | "B", i: number) => (org === "A" ? storesA : storesB)[i]!;
    const orgId = (org: "A" | "B") => (org === "A" ? A : B).orgId;

    /** Effective permissions, computed by the database's own function for the configuration. */
    const effective = (m: Membership) =>
      sql(
        `select array_to_string(public.effective_permissions_for('${m.role}', null, array[${(m.extra ?? []).map((p) => `'${p}'`).join(",")}]::text[], array[${(m.revoked ?? []).map((p) => `'${p}'`).join(",")}]::text[]), ',')`,
      ).split(",");
    /** The intended rule, written out: member of the row's organization, a financial permission there
     *  (owners always), and the row's store accessible (owners: every store of the organization). */
    const intended = (who: Identity, rows: { id: string; org: string; loc: string }[]) => {
      const allowed = new Set<string>();
      for (const m of who.memberships) {
        const perms = m.role === "owner" ? FIN : effective(m);
        if (!FIN.some((p) => perms.includes(p))) continue;
        const locs =
          m.role === "owner"
            ? m.org === "A"
              ? storesA
              : storesB
            : m.stores.map((i) => store(m.org, i));
        for (const l of locs) allowed.add(`${orgId(m.org)}|${l}`);
      }
      return rows
        .filter((r) => allowed.has(`${r.org}|${r.loc}`))
        .map((r) => r.id)
        .sort();
    };
    const asIdentity = <T>(userId: string, body: (tx: postgres.TransactionSql) => Promise<T>) =>
      db.begin(async (tx) => {
        const claims = JSON.stringify({ sub: userId, role: "authenticated" });
        await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true)`;
        return body(tx);
      }) as Promise<T>;

    beforeAll(async () => {
      sql = await disposableQa(URL_, "test:finance-rls-equivalence");
      db = postgres(DB_URL, { max: 1, onnotice: () => {} });
      const creds = JSON.parse(fs.readFileSync(process.env["CREDS_FILE"]!, "utf8")) as {
        admin: { userId: string };
      };
      const mk = (label: string, memberships: Membership[]) => {
        const userId = crypto.randomUUID();
        synthetic.push(userId);
        ids.push({ label, userId, memberships, synthetic: true });
      };
      mk("owner A", [{ org: "A", role: "owner", stores: [] }]);
      mk("manager A, store 0 only", [{ org: "A", role: "manager", stores: [0] }]);
      mk("manager A, all 4 stores", [{ org: "A", role: "manager", stores: [0, 1, 2, 3] }]);
      mk("manager A, financial permissions revoked", [
        { org: "A", role: "manager", stores: [0, 1], revoked: FIN },
      ]);
      mk("staff A, no financial permission", [{ org: "A", role: "staff", stores: [0] }]);
      mk("staff A + finance.view, store 1", [
        { org: "A", role: "staff", stores: [1], extra: ["finance.view"] },
      ]);
      mk("staff A + reports.view, store 2", [
        { org: "A", role: "staff", stores: [2], extra: ["reports.view"] },
      ]);
      mk("staff A + dashboard.financials, stores 2-3", [
        { org: "A", role: "staff", stores: [2, 3], extra: ["dashboard.financials"] },
      ]);
      mk("staff A + finance.view, NO store", [
        { org: "A", role: "staff", stores: [], extra: ["finance.view"] },
      ]);
      mk("owner B", [{ org: "B", role: "owner", stores: [] }]);
      mk("member of both: staff A + finance.view store 3; manager B store 0", [
        { org: "A", role: "staff", stores: [3], extra: ["finance.view"] },
        { org: "B", role: "manager", stores: [0] },
      ]);
      mk("not a member", []);
      ids.push({
        label: "platform admin",
        userId: creds.admin.userId,
        memberships: [],
        synthetic: false,
      });

      sql(
        createTestUsersSql(
          synthetic.map((u, i) => ({
            userId: u,
            email: `rls-eq-${i}-${u.slice(0, 8)}@example.test`,
          })),
        ),
      );
      A = isolatedOrg("rlsa", { plan: "enterprise" });
      B = isolatedOrg("rlsb", { plan: "enterprise" });
      sql(createIsolatedOrgSql(A));
      sql(createIsolatedOrgSql(B));
      storesA.push(A.locationId);
      storesB.push(B.locationId);
      for (const [org, list, n] of [
        [A, storesA, 3],
        [B, storesB, 1],
      ] as const)
        for (let i = 0; i < n; i++) {
          const id = crypto.randomUUID();
          sql(
            `insert into public.locations(id, org_id, slug, name, address) values ('${id}', '${org.orgId}', 't_${org.key}_s${i}', 'S${i}', '1 Test Street');`,
          );
          list.push(id);
        }
      const owners = ids.filter((x) => x.memberships.some((m) => m.role === "owner"));
      for (const who of ids.filter((x) => x.synthetic))
        for (const m of who.memberships) {
          const memberId = crypto.randomUUID();
          sql(`insert into public.organization_members(id, org_id, user_id, role, extra_permissions, revoked_permissions)
               values ('${memberId}', '${orgId(m.org)}', '${who.userId}', '${m.role}',
                       array[${(m.extra ?? []).map((p) => `'${p}'`).join(",")}]::text[], array[${(m.revoked ?? []).map((p) => `'${p}'`).join(",")}]::text[]);`);
          for (const i of m.stores)
            sql(
              `insert into public.member_location_access(member_id, location_id) values ('${memberId}', '${store(m.org, i)}');`,
            );
        }
      sql(`update public.organization_members set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions)
            where org_id in ('${A.orgId}', '${B.orgId}');`);
      // ledger rows in EVERY store of both organizations (actor: an owner)
      const actor = owners[0]!.userId;
      for (const [org, list] of [
        [A, storesA],
        [B, storesB],
      ] as const)
        for (const [i, loc] of list.entries())
          sql(`insert into public.finance_entries(org_id, location_id, kind, amount_cents, client_event_id, description, actor_id, created_at)
               select '${org.orgId}', '${loc}', (array['revenue','cogs','reversal_revenue'])[1 + g % 3], 100 + g,
                      '${org.key}-${i}-' || g, 'rls equivalence', '${actor}', now() - (g * interval '1 hour')
               from generate_series(1, 6) g;`);
    }, 180_000);

    afterAll(async () => {
      if (A && B) sql(dropIsolatedOrgsSql([A.orgId, B.orgId]));
      if (synthetic.length) sql(dropTestUsersSql(synthetic));
      await db?.end({ timeout: 5 });
    });

    it("for every identity: current (RLS) = previous policy = intended rule, over the whole ledger", async () => {
      const all =
        (await db`select id::text, org_id::text as org, location_id::text as loc from public.finance_entries`) as unknown as {
          id: string;
          org: string;
          loc: string;
        }[];
      expect(all.length).toBeGreaterThanOrEqual(36);
      const report: string[] = [];
      for (const who of ids) {
        const [previous, current] = await asIdentity(who.userId, async (tx) => {
          const before = await tx.unsafe(
            `select id::text from public.finance_entries where ${PREVIOUS} order by 1`,
          );
          await tx`set local role authenticated`;
          const after = await tx`select id::text from public.finance_entries order by 1`;
          return [before.map((r) => r["id"] as string), after.map((r) => r["id"] as string)];
        });
        const want = intended(who, all);
        expect(previous, `${who.label}: previous policy vs intended rule`).toEqual(want);
        expect(current, `${who.label}: rewritten policy vs previous policy`).toEqual(previous);
        report.push(`${who.label}: ${current.length}`);
      }
      console.log(`[rls] ${all.length} ledger rows → ${report.join(" · ")}`);
    });

    it("negative: nobody reads a row of a store it cannot access or of an organization it does not belong to", async () => {
      for (const who of ids) {
        const visible = (await asIdentity(who.userId, async (tx) => {
          await tx`set local role authenticated`;
          return tx`select org_id::text as org, location_id::text as loc from public.finance_entries`;
        })) as unknown as { org: string; loc: string }[];
        const allowedOrgs = new Set(who.memberships.map((m) => orgId(m.org)));
        const allowedStores = new Set(
          who.memberships.flatMap((m) =>
            m.role === "owner"
              ? m.org === "A"
                ? storesA
                : storesB
              : m.stores.map((i) => store(m.org, i)),
          ),
        );
        for (const r of visible) {
          expect(allowedOrgs.has(r.org), `${who.label} read another organization`).toBe(true);
          expect(allowedStores.has(r.loc), `${who.label} read another store`).toBe(true);
        }
      }
    });

    it("negative: ledger_day_totals with forced store ids never returns another store's or tenant's figures", async () => {
      const call = (userId: string, org: string, locs: string[]) =>
        asIdentity(userId, async (tx) => {
          await tx`set local role authenticated`;
          const [r] =
            await tx`select public.ledger_day_totals(${org}::uuid, ${locs}::uuid[], null, true) as r`;
          return r!["r"] as { buckets: unknown[]; yesterday: unknown[]; stores: unknown[] };
        });
      const byLabel = (l: string) => ids.find((x) => x.label.startsWith(l))!.userId;
      // manager of store 0 asks for stores 1-3 of its own organization
      const m = await call(byLabel("manager A, store 0"), A.orgId, storesA.slice(1));
      expect(m.buckets).toEqual([]);
      expect(m.yesterday).toEqual([]);
      // organization A's owner asks for organization B (its ids are known to the attacker)
      const x = await call(byLabel("owner A"), B.orgId, storesB);
      expect(x.buckets).toEqual([]);
      expect(x.stores).toEqual([]); // B's stores are not even visible
      // organization A's owner names B's stores under A's id
      const y = await call(byLabel("owner A"), A.orgId, storesB);
      expect(y.buckets).toEqual([]);
      // staff with a financial permission but no store
      expect(
        (await call(byLabel("staff A + finance.view, NO store"), A.orgId, storesA)).buckets,
      ).toEqual([]);
      // platform admin and non-member
      for (const l of ["platform admin", "not a member"])
        expect((await call(byLabel(l), A.orgId, storesA)).buckets, l).toEqual([]);
      // positive control: the owner does see its own figures
      expect((await call(byLabel("owner A"), A.orgId, storesA)).buckets.length).toBeGreaterThan(0);
    });

    it("accessible_location_ids() = can_access_location() for every identity and store", async () => {
      const locs = [...storesA, ...storesB];
      for (const who of ids) {
        const [viaHelper, viaPrevious] = await asIdentity(who.userId, async (tx) => {
          const h =
            await tx`select x::text as id from public.accessible_location_ids() x where x = any(${locs}::uuid[]) order by 1`;
          const p =
            await tx`select l::text as id from unnest(${locs}::uuid[]) l where public.can_access_location(l) order by 1`;
          return [h.map((r) => r["id"]), p.map((r) => r["id"])];
        });
        expect(viaHelper, who.label).toEqual(viaPrevious);
      }
    });

    it("helpers follow the safe pattern: fixed search_path, restricted execution", () => {
      const attrs = (sig: string) =>
        sql(`select p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), '')
                    || '|' || has_function_privilege('anon', '${sig}', 'execute')
                    || '|' || has_function_privilege('authenticated', '${sig}', 'execute')
                    || '|' || exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
               from pg_proc p where p.oid = '${sig}'::regprocedure`);
      // SECURITY DEFINER, STABLE, search_path=public, anon no, authenticated yes, PUBLIC no
      expect(attrs("public.accessible_location_ids()")).toBe(
        "true|s|search_path=public|false|true|false",
      );
      // SECURITY INVOKER (RLS decides), STABLE, search_path=public, anon no, authenticated yes, PUBLIC no
      expect(attrs("public.ledger_day_totals(uuid, uuid[], integer, boolean)")).toBe(
        "false|s|search_path=public|false|true|false",
      );
      // the only policy is SELECT for authenticated (writes go through the sale/cancel/receive RPCs)
      expect(
        sql(
          `select polcmd::text || '|' || array_to_string(polroles::regrole[], ',') from pg_policy where polrelid = 'public.finance_entries'::regclass`,
        ),
      ).toBe("r|authenticated");
    });

    it("negative: even an owner cannot write the ledger directly (no INSERT/UPDATE/DELETE policy)", async () => {
      const owner = ids.find((x) => x.label === "owner A")!.userId;
      // An error aborts the transaction, so it is caught outside it (nothing is committed either way).
      const attempt = (statement: string) =>
        asIdentity(owner, async (tx) => {
          await tx`set local role authenticated`;
          const r = await tx.unsafe(statement);
          return `ok:${r.count}`;
        }).catch((e: unknown) => `refused:${String((e as Error).message).split("\n")[0]}`);
      const ins = await attempt(
        `insert into public.finance_entries(org_id, location_id, kind, amount_cents, client_event_id, description, actor_id)
         values ('${A.orgId}', '${storesA[0]}', 'revenue', 1, 'direct-write', 'x', '${owner}')`,
      );
      expect(ins).toMatch(/^refused:new row violates row-level security policy/);
      // UPDATE / DELETE see no row through RLS: nothing is changed
      expect(
        await attempt(
          `update public.finance_entries set amount_cents = 0 where org_id = '${A.orgId}'`,
        ),
      ).toBe("ok:0");
      expect(await attempt(`delete from public.finance_entries where org_id = '${A.orgId}'`)).toBe(
        "ok:0",
      );
      expect(
        Number(
          sql(
            `select count(*) from public.finance_entries where org_id = '${A.orgId}' and amount_cents = 0`,
          ),
        ),
      ).toBe(0);
      expect(
        Number(sql(`select count(*) from public.finance_entries where org_id = '${A.orgId}'`)),
      ).toBe(24);
    });
  },
);
