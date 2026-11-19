// Database integration test for M2 (migration 0031 ledger_day_totals). Runs only against a
// DISPOSABLE stack (QA_M2_DB=1 + target guard), never by default.
//
// Three sources are compared on the real database, signed in as real members (RLS applies):
//   1. SQL truth straight from finance_entries (postgres superuser, per store zone);
//   2. the new aggregation (readLedgerSummaryAggregated → ledger_day_totals);
//   3. the wave-0 paged reader (readLedgerSummary), the reference that is already proven.
// Isolation: its own organization (4 stores in 4 US zones), removed at the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../integrations/supabase/types";
import {
  readLedgerSummary,
  type LedgerClient,
  type LedgerStore,
  type LedgerSummary,
} from "../../lib/ledger-reader";
import { readLedgerSummaryAggregated } from "../../lib/ledger-aggregate";
import { PERIOD } from "../../lib/financial-period";
import { periodFigures, previousFigures } from "../../lib/financial-summary";
import {
  createIsolatedOrgSql,
  dropIsolatedOrgsSql,
  isolatedOrg,
  type IsolatedOrg,
} from "../../../scripts/qa/isolated-org.mjs";
import { disposableQa, dropPooledConnections, type QaSql } from "./qa-db";

const ENABLED = process.env["QA_M2_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";
const DB_URL = process.env["QA_DB_URL"] ?? "";
const ZONES = ["America/New_York", "America/Chicago", "America/Los_Angeles", "Pacific/Honolulu"];

type Creds = {
  owner: { email: string; password: string; userId: string };
  team: { manager: { email: string; password: string; userId: string } };
  roles: Record<string, { userId: string; password: string }>;
  tenantB: { owner: { email: string; password: string } };
  admin: { email: string; password: string };
};

describe.skipIf(!ENABLED)(
  "M2 ledger_day_totals against the real database (disposable stack)",
  { timeout: 900_000 },
  () => {
    let sql: QaSql;
    let org: IsolatedOrg;
    let creds: Creds;
    let owner: SupabaseClient<Database>;
    const stores: LedgerStore[] = [];

    const signIn = async (who: { email: string; password: string }) => {
      const c = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await c.auth.signInWithPassword(who);
      if (error) throw new Error("sign-in failed");
      return c;
    };
    const clear = () => sql(`delete from public.finance_entries where org_id = '${org.orgId}';`);
    /** n rows per store; `at` is a SQL timestamptz expression over the series index g. */
    const insert = (storeId: string, tag: string, n: number, at: string) =>
      sql(`insert into public.finance_entries(org_id, location_id, kind, amount_cents, client_event_id, description, actor_id, created_at)
           select '${org.orgId}', '${storeId}',
                  (array['revenue','cogs','reversal_revenue','revenue','cogs','purchase','reversal_cogs'])[1 + g % 7],
                  1 + (g * 37) % 997, '${org.key}-${tag}-' || g, 'm2 synthetic', '${creds.owner.userId}', ${at}
           from generate_series(1, ${n}) g;`);
    /** SQL truth for every store: "store|day|kind|sum|count", each store in its CURRENT zone. */
    const truth = (days: number | null) =>
      sql(`select l.id || '|' || d || '|' || kind || '|' || s || '|' || c from (
             select f.location_id, (f.created_at at time zone l.timezone)::date as d, f.kind,
                    sum(f.amount_cents) s, count(*) c
               from public.finance_entries f join public.locations l on l.id = f.location_id
              where f.org_id = '${org.orgId}' and f.created_at < now()
                ${days === null ? "" : `and (f.created_at at time zone l.timezone)::date > (now() at time zone l.timezone)::date - ${days}`}
              group by 1, 2, 3) t join public.locations l on l.id = t.location_id`)
        .split("\n")
        .filter(Boolean)
        .sort();
    const asTruth = (s: LedgerSummary) =>
      s.buckets
        .map((b) => `${b.locationId}|${b.day}|${b.kind}|${b.amountCents}|${b.entries}`)
        .sort();
    const agg = async (
      c: SupabaseClient<Database>,
      days: number | null,
      list = stores,
      y = false,
    ) =>
      (await readLedgerSummaryAggregated(c, {
        orgId: org.orgId,
        stores: list,
        days,
        sameTimeYesterday: y,
      }))!;
    const paged = (c: SupabaseClient<Database>, days: number | null, y = false) =>
      readLedgerSummary(c as unknown as LedgerClient, {
        orgId: org.orgId,
        stores,
        days,
        sameTimeYesterday: y,
        maxRows: 2_000_000,
      });

    beforeAll(async () => {
      sql = await disposableQa(URL_, "test:ledger-aggregate");
      creds = JSON.parse(fs.readFileSync(process.env["CREDS_FILE"]!, "utf8")) as Creds;
      const cashier = Object.entries(creds.roles).find(([e]) => e.startsWith("cashier"))![1];
      org = isolatedOrg("m2", {
        members: [
          { userId: creds.owner.userId, role: "owner" },
          // the manager may access ONLY the first store; the cashier is staff (no finance access)
          { userId: creds.team.manager.userId, role: "manager", store: true },
          { userId: cashier.userId, role: "staff", store: true },
        ],
        plan: "enterprise",
      });
      sql(createIsolatedOrgSql(org));
      sql(`update public.locations set timezone = '${ZONES[0]}' where id = '${org.locationId}';`);
      stores.push({ id: org.locationId, timeZone: ZONES[0]! });
      for (const [i, zone] of ZONES.slice(1).entries()) {
        const id = crypto.randomUUID();
        sql(`insert into public.locations(id, org_id, slug, name, address, timezone)
             values ('${id}', '${org.orgId}', 't_${org.key}_z${i}', 'Zone ${zone}', '1 Test Street', '${zone}');`);
        stores.push({ id, timeZone: zone });
      }
      owner = await signIn(creds.owner);
    }, 180_000);

    // Removing up to 1,000,000 ledger rows takes longer than vitest's 10 s default.
    afterAll(() => {
      if (org) sql(dropIsolatedOrgsSql([org.orgId]));
    }, 180_000);

    it.each([999, 1000, 1001, 10_000, 100_000])(
      "%i rows over 4 stores × 4 zones (with ties): aggregation = SQL = paged reader",
      async (n) => {
        clear();
        const per = Math.ceil(n / 4);
        for (const [i, st] of stores.entries())
          insert(
            st.id,
            `v${n}-${i}`,
            i === 3 ? n - per * 3 : per,
            `now() - interval '200 days' + ((g / 7) * interval '1 minute')`,
          );
        const t0 = performance.now();
        const a = await agg(owner, null);
        const ta = performance.now() - t0;
        const t1 = performance.now();
        const p = await paged(owner, null);
        const tp = performance.now() - t1;
        expect(a.complete).toBe(true);
        expect(p.complete).toBe(true);
        expect(a.rowsRead).toBe(n);
        expect(asTruth(a)).toEqual(truth(null));
        expect(asTruth(a)).toEqual(asTruth(p));
        console.log(`[m2] ${n} rows: aggregated ${ta.toFixed(0)} ms · paged ${tp.toFixed(0)} ms`);
      },
    );

    it("1,000,000 rows: aggregation = SQL (the paged reader is not compared: beyond its ceiling)", async () => {
      clear();
      for (const [i, st] of stores.entries())
        insert(
          st.id,
          `m-${i}`,
          250_000,
          `now() - interval '720 days' + (g * interval '4 minutes')`,
        );
      sql("analyze public.finance_entries;");
      // the synchronous fixture blocked the event loop for ~80 s (see dropPooledConnections)
      dropPooledConnections();
      const t0 = performance.now();
      const a = await agg(owner, null);
      const ms = performance.now() - t0;
      expect(a.rowsRead).toBe(1_000_000);
      expect(asTruth(a)).toEqual(truth(null));
      const t1 = performance.now();
      const a60 = await agg(owner, 60);
      const ms60 = performance.now() - t1;
      expect(asTruth(a60)).toEqual(truth(60));
      console.log(
        `[m2] 1,000,000 rows: whole history ${ms.toFixed(0)} ms · 60 days ${ms60.toFixed(0)} ms (${a.buckets.length} buckets)`,
      );
    });

    it("DST start (Mar 8 2026) and end (Nov 1 2026) in 4 zones: local days equal SQL and the paged reader", async () => {
      clear();
      for (const [i, st] of stores.entries()) {
        insert(
          st.id,
          `dst-s-${i}`,
          24 * 4,
          `timestamptz '2026-03-06 00:30:00+00' + (g * interval '1 hour')`,
        );
        insert(
          st.id,
          `dst-e-${i}`,
          24 * 4,
          `timestamptz '2026-10-30 00:30:00+00' + (g * interval '1 hour')`,
        );
      }
      const a = await agg(owner, null);
      const p = await paged(owner, null);
      expect(asTruth(a)).toEqual(truth(null));
      expect(asTruth(a)).toEqual(asTruth(p));
      // New York on the fall-back day has 25 hourly rows; Honolulu (no DST) 24.
      const ny = a.buckets.filter((b) => b.locationId === stores[0]!.id && b.day === "2026-11-01");
      const hnl = a.buckets.filter((b) => b.locationId === stores[3]!.id && b.day === "2026-11-01");
      expect(ny.reduce((s, b) => s + b.entries, 0)).toBe(25);
      expect(hnl.reduce((s, b) => s + b.entries, 0)).toBe(24);
      const nyMar = a.buckets.filter(
        (b) => b.locationId === stores[0]!.id && b.day === "2026-03-08",
      );
      expect(nyMar.reduce((s, b) => s + b.entries, 0)).toBe(23);
    });

    it("periods: today, 7/30 days, month and the comparison windows are identical to the paged reader", async () => {
      clear();
      for (const [i, st] of stores.entries())
        insert(
          st.id,
          `per-${i}`,
          24 * 70,
          `now() - interval '69 days' + (g * interval '1 hour') - interval '30 minutes'`,
        );
      for (const days of [1, 7, 30, 60]) {
        const a = await agg(owner, days, stores, true);
        const p = await paged(owner, days, true);
        expect(asTruth(a), `days=${days}`).toEqual(truth(days));
        expect(asTruth(a)).toEqual(asTruth(p));
        expect(a.stores.map((s) => s.today)).toEqual(p.stores.map((s) => s.today));
        expect(a.sameTimeYesterday).toEqual(p.sameTimeYesterday);
        for (const spec of [PERIOD.today, PERIOD.days(7), PERIOD.month])
          expect(periodFigures(a, spec)).toEqual(periodFigures(p, spec));
        expect(previousFigures(a, PERIOD.days(7))).toEqual(previousFigures(p, PERIOD.days(7)));
      }
    });

    it("back-dated entries are reflected on the next read (no stored totals to maintain)", async () => {
      clear();
      insert(stores[0]!.id, "base", 500, `now() - interval '10 days' + (g * interval '1 minute')`);
      const before = await agg(owner, null);
      insert(stores[0]!.id, "late", 3, `now() - interval '400 days'`);
      const after = await agg(owner, null);
      expect(after.rowsRead).toBe(before.rowsRead + 3);
      expect(asTruth(after)).toEqual(truth(null));
    });

    it("changing a store's zone re-buckets its history into the new zone (documented), equal to SQL", async () => {
      clear();
      insert(
        stores[0]!.id,
        "tz",
        48,
        `timestamptz '2026-11-05 00:30:00+00' + (g * interval '1 hour')`,
      );
      const before = await agg(owner, null, [stores[0]!]);
      sql(`update public.locations set timezone = 'Asia/Tokyo' where id = '${stores[0]!.id}';`);
      try {
        const after = await agg(owner, null, [stores[0]!]);
        expect(after.stores[0]!.timeZone).toBe("Asia/Tokyo");
        expect(asTruth(after)).toEqual(truth(null).filter((r) => r.startsWith(stores[0]!.id)));
        expect(asTruth(after)).not.toEqual(asTruth(before)); // days moved
        expect(after.rowsRead).toBe(before.rowsRead); // nothing lost or duplicated
      } finally {
        sql(`update public.locations set timezone = '${ZONES[0]}' where id = '${stores[0]!.id}';`);
      }
    });

    it("concurrency: an uncommitted insert is not read; after COMMIT the next read includes it", async () => {
      clear();
      insert(stores[0]!.id, "cc", 100, `now() - interval '1 day' + (g * interval '1 minute')`);
      const db = postgres(DB_URL, { max: 1, onnotice: () => {} });
      try {
        await db.begin(async (tx) => {
          await tx`insert into public.finance_entries(org_id, location_id, kind, amount_cents, client_event_id, description, actor_id)
                   values (${org.orgId}, ${stores[0]!.id}, 'revenue', 777, ${org.key + "-open"}, 'open tx', ${creds.owner.userId})`;
          const during = await agg(owner, null);
          expect(during.rowsRead).toBe(100);
        });
        const after = await agg(owner, null);
        expect(after.rowsRead).toBe(101);
        expect(asTruth(after)).toEqual(truth(null));
      } finally {
        await db.end({ timeout: 5 });
      }
    });

    it("RLS and permissions: manager sees only the store it can access; staff, other tenant and platform admin see nothing", async () => {
      clear();
      for (const [i, st] of stores.entries())
        insert(st.id, `rls-${i}`, 10, `now() - interval '1 day' + (g * interval '1 minute')`);
      const manager = await signIn(creds.team.manager);
      const m = await agg(manager, null);
      expect([...new Set(m.buckets.map((b) => b.locationId))]).toEqual([stores[0]!.id]);
      const cashierCreds = Object.entries(creds.roles).find(([e]) => e.startsWith("cashier"))!;
      const cashier = await signIn({ email: cashierCreds[0], password: cashierCreds[1].password });
      expect((await agg(cashier, null)).buckets).toEqual([]);
      const other = await signIn(creds.tenantB.owner);
      expect((await agg(other, null)).buckets).toEqual([]);
      const admin = await signIn(creds.admin);
      expect((await agg(admin, null)).buckets).toEqual([]);
    });

    it("rewritten finance_read = previous policy: the SAME rows for every caller, across every organization", async () => {
      clear();
      for (const [i, st] of stores.entries())
        insert(st.id, `eq-${i}`, 25, `now() - interval '3 days' + (g * interval '1 minute')`);
      const roleUser = (prefix: string) =>
        Object.entries(creds.roles).find(([e]) => e.startsWith(prefix))![1].userId;
      const users: [string, string][] = [
        ["owner", creds.owner.userId],
        ["manager (one store here)", creds.team.manager.userId],
        ["cashier (staff)", roleUser("cashier")],
        ["kitchen (staff)", roleUser("kitchen")],
        ["stock", roleUser("stock")],
        ["finance profile", roleUser("finance")],
        ["platform admin", (creds.admin as unknown as { userId: string }).userId],
        ["other tenant owner", (creds.tenantB.owner as unknown as { userId: string }).userId],
        ["not a member", crypto.randomUUID()],
      ];
      const OLD = `public.is_org_member(org_id) and public.can_access_location(location_id)
        and org_id in (select public.orgs_with_any_permission(array['finance.view','dashboard.financials','reports.view']))`;
      const db = postgres(DB_URL, { max: 1, onnotice: () => {} });
      try {
        const total = (await db`select count(*)::int c from public.finance_entries`)[0]![
          "c"
        ] as number;
        expect(total).toBeGreaterThan(100);
        const summary: string[] = [];
        for (const [label, uid] of users) {
          const claims = JSON.stringify({ sub: uid, role: "authenticated" });
          const [oldIds, newIds] = await db.begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${uid}, true)`;
            // previous expression, evaluated with the caller's identity (superuser: no RLS involved)
            const before = await tx.unsafe(
              `select id::text from public.finance_entries where ${OLD} order by 1`,
            );
            await tx`set local role authenticated`;
            const after = await tx`select id::text from public.finance_entries order by 1`; // new policy
            return [before.map((r) => r["id"]), after.map((r) => r["id"])];
          });
          expect(newIds, label).toEqual(oldIds);
          summary.push(`${label}: ${newIds.length}`);
        }
        console.log(`[m2] RLS equivalence over ${total} ledger rows → ${summary.join(" · ")}`);
      } finally {
        await db.end({ timeout: 5 });
      }
    });

    it("execution is restricted: anon cannot call the function", async () => {
      const anon = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await anon.rpc("ledger_day_totals", { _org_id: org.orgId });
      expect(error).not.toBeNull();
    });
  },
);
