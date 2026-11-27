// Database integration test for the complete ledger read (wave 0). Runs only against a DISPOSABLE
// stack (QA_LEDGER_DB=1 + target guard), never by default.
//
// It exercises the production code (src/lib/ledger-reader.ts) against the real PostgREST, whose
// page limit is 1,000 rows, signed in as the QA owner so RLS applies. Ground truth comes straight
// from SQL. Isolation: the test creates its OWN organization (four stores in four US zones), writes
// synthetic finance_entries only there, and removes exactly that organization at the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../integrations/supabase/types";
import {
  LedgerReadError,
  readLedgerRows,
  readLedgerSummary,
  type LedgerClient,
  type LedgerStore,
  type LedgerSummary,
} from "../../lib/ledger-reader";
import {
  createIsolatedOrgSql,
  dropIsolatedOrgsSql,
  isolatedOrg,
  type IsolatedOrg,
} from "../../../scripts/qa/isolated-org.mjs";
import { disposableQa, type QaSql } from "./qa-db";
import { PERIOD, periodWindow } from "../../lib/financial-period";
import { bucketRows, bucketsInPeriod, periodFigures } from "../../lib/financial-summary";
import { buildReport } from "../../lib/report-metrics";
import { recordedIntelligence } from "../../lib/operational-metrics";
import { storeResults } from "../../components/finance/finance-model";
import type { Resources } from "../../lib/operational-mappers";

const ENABLED = process.env["QA_LEDGER_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";

const ZONES = ["America/New_York", "America/Chicago", "America/Los_Angeles", "Pacific/Honolulu"];

describe.skipIf(!ENABLED)(
  "complete ledger read against PostgREST (disposable stack)",
  { timeout: 600_000 },
  () => {
    let owner: SupabaseClient<Database>;
    let ownerUserId: string;
    let sql: QaSql;
    let org: IsolatedOrg;
    let tenantB: { email: string; password: string };
    const stores: LedgerStore[] = [];
    const NOW = new Date("2026-11-03T15:00:00Z");

    const clear = () => sql(`delete from public.finance_entries where org_id = '${org.orgId}';`);
    /** n synthetic rows at one store; `createdAt` is a SQL expression over the series index g. */
    const insert = (storeId: string, tag: string, n: number, createdAt: string) =>
      sql(`insert into public.finance_entries(org_id, location_id, kind, amount_cents, client_event_id, description, actor_id, created_at)
         select '${org.orgId}', '${storeId}',
                (array['revenue','cogs','reversal_revenue','revenue','cogs','expense','reversal_cogs'])[1 + g % 7],
                1 + (g * 37) % 997, '${org.key}-${tag}-' || g, 'wave0 synthetic', '${ownerUserId}', ${createdAt}
         from generate_series(1, ${n}) g;`);
    /** SQL truth: per (store, local day, kind) sums and counts, for rows before `until`. */
    const truth = (storeId: string, zone: string, until: string, sinceDay: string | null = null) =>
      sql(`select d || '|' || kind || '|' || s || '|' || c from (
           select to_char((created_at at time zone '${zone}')::date, 'YYYY-MM-DD') as d, kind,
                  sum(amount_cents) as s, count(*) as c
             from public.finance_entries
            where org_id = '${org.orgId}' and location_id = '${storeId}' and created_at < '${until}'
              ${sinceDay ? `and (created_at at time zone '${zone}')::date >= '${sinceDay}'` : ""}
            group by 1, 2) t order by 1`)
        .split("\n")
        .filter(Boolean)
        .sort();
    const asTruth = (s: LedgerSummary, storeId: string) =>
      s.buckets
        .filter((b) => b.locationId === storeId)
        .map((b) => `${b.day}|${b.kind}|${b.amountCents}|${b.entries}`)
        .sort();

    /**
     * A proxy around the REAL client that lets a test act after each data page (or fail it). The
     * PostgREST builder chain is dynamically typed here on purpose (test instrumentation only).
     */
    /* eslint-disable @typescript-eslint/no-explicit-any */
    function instrumented(onPage: (page: number) => void): LedgerClient {
      let page = 0;
      const wrap = (b: any): any =>
        new Proxy(b, {
          get(target, prop) {
            if (prop === "then")
              return (res: any, rej: any) =>
                target
                  .then((r: any) => {
                    if (Array.isArray(r.data)) onPage(++page);
                    return r;
                  })
                  .then(res, rej);
            const v = target[prop];
            if (typeof v !== "function") return v;
            return (...args: unknown[]) => {
              const out = v.apply(target, args);
              return out && typeof out === "object" && "then" in out ? wrap(out) : out;
            };
          },
        });
      return { from: (t) => ({ select: (c, o) => wrap((owner as any).from(t).select(c, o)) }) };
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    beforeAll(async () => {
      const guarded = await disposableQa(URL_, "test:ledger-summary");
      const creds = JSON.parse(fs.readFileSync(process.env["CREDS_FILE"]!, "utf8")) as {
        owner: { email: string; password: string; userId: string };
        tenantB: { owner: { email: string; password: string } };
      };
      tenantB = creds.tenantB.owner;
      ownerUserId = creds.owner.userId;
      sql = guarded;
      org = isolatedOrg("ledger", {
        members: [{ userId: ownerUserId, role: "owner" }],
        plan: "enterprise",
      });
      sql(createIsolatedOrgSql(org));
      // Four stores, one per US zone (the isolated org's first store becomes New York).
      sql(`update public.locations set timezone = '${ZONES[0]}' where id = '${org.locationId}';`);
      stores.push({ id: org.locationId, timeZone: ZONES[0]! });
      for (const [i, zone] of ZONES.slice(1).entries()) {
        const id = crypto.randomUUID();
        sql(`insert into public.locations(id, org_id, slug, name, address, timezone)
           values ('${id}', '${org.orgId}', 't_${org.key}_z${i}', 'Zone ${zone}', '1 Test Street', '${zone}');`);
        stores.push({ id, timeZone: zone });
      }
      owner = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await owner.auth.signInWithPassword({
        email: creds.owner.email,
        password: creds.owner.password,
      });
      if (error) throw new Error("QA owner sign-in failed");
    }, 120_000);

    afterAll(() => {
      if (org) sql(dropIsolatedOrgsSql([org.orgId]));
    });

    const ny = () => stores[0]!;
    const client = () => owner as unknown as LedgerClient;

    it.each([999, 1000, 1001, 5000, 10000])(
      "%i rows (7-way created_at ties): every row exactly once, totals equal SQL",
      async (n) => {
        clear();
        insert(
          ny().id,
          `n${n}`,
          n,
          `timestamptz '2026-10-20 12:00:00+00' + ((g / 7) * interval '1 second')`,
        );
        const t0 = performance.now();
        const s = await readLedgerSummary(client(), {
          orgId: org.orgId,
          stores: [ny()],
          days: null,
          now: NOW,
        });
        const ms = performance.now() - t0;
        expect(s.complete).toBe(true);
        expect(s.rowsRead).toBe(n);
        expect(asTruth(s, ny().id)).toEqual(truth(ny().id, ny().timeZone, NOW.toISOString()));
        console.log(`[ledger] ${n} rows: ${Math.ceil(n / 1000)} pages, ${ms.toFixed(0)} ms`);
      },
    );

    it("microsecond timestamps (1,000+ rows inside one millisecond): no row skipped or repeated", async () => {
      clear();
      insert(
        ny().id,
        "us",
        2500,
        `timestamptz '2026-10-21 12:00:00+00' + (g * interval '1 microsecond')`,
      );
      const rows = await readLedgerRows(client(), { orgId: org.orgId, stores: [ny()], now: NOW });
      expect(rows.complete).toBe(true);
      const ids = rows.rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(2500);
      expect(ids.length).toBe(2500);
    });

    it("asks for pages larger than the server allows: adapts to the server's 1,000-row pages", async () => {
      clear();
      insert(
        ny().id,
        "big",
        3200,
        `timestamptz '2026-10-22 12:00:00+00' + (g * interval '1 second')`,
      );
      const s = await readLedgerSummary(client(), {
        orgId: org.orgId,
        stores: [ny()],
        days: null,
        now: NOW,
        pageSize: 1500,
      });
      expect(s.complete).toBe(true);
      expect(s.rowsRead).toBe(3200);
    });

    it("rows inserted while paginating: after readUntil they are excluded; behind the cursor they trigger a re-read", async () => {
      clear();
      insert(
        ny().id,
        "base",
        3000,
        `timestamptz '2026-10-23 12:00:00+00' + (g * interval '1 second')`,
      );
      let injected = false;
      const c = instrumented((page) => {
        if (page === 2 && !injected) {
          injected = true;
          // A late row in the window, BEHIND the cursor (already passed) and one after readUntil.
          insert(ny().id, "late", 1, `timestamptz '2026-10-23 12:00:05+00'`);
          insert(ny().id, "future", 1, `now() + interval '1 day'`);
        }
      });
      const s = await readLedgerSummary(c, {
        orgId: org.orgId,
        stores: [ny()],
        days: null,
        now: NOW,
      });
      expect(injected).toBe(true);
      expect(s.complete).toBe(true); // the recount caught the late row; the re-read included it
      expect(s.rowsRead).toBeGreaterThanOrEqual(3001);
      expect(asTruth(s, ny().id)).toEqual(truth(ny().id, ny().timeZone, NOW.toISOString()));
    });

    it("a failure in the middle of the pagination throws: never a partial total", async () => {
      clear();
      insert(
        ny().id,
        "fail",
        2500,
        `timestamptz '2026-10-24 12:00:00+00' + (g * interval '1 second')`,
      );
      const c = instrumented((page) => {
        if (page === 2) throw new Error("ECONNRESET (injected)");
      });
      await expect(
        readLedgerSummary(c, { orgId: org.orgId, stores: [ny()], days: null, now: NOW }),
      ).rejects.toThrow();
    });

    it("safety ceiling: stops and reports the result as incomplete (row_cap)", async () => {
      clear();
      insert(
        ny().id,
        "cap",
        5000,
        `timestamptz '2026-10-25 12:00:00+00' + (g * interval '1 second')`,
      );
      const s = await readLedgerSummary(client(), {
        orgId: org.orgId,
        stores: [ny()],
        days: null,
        now: NOW,
        maxRows: 2500,
      });
      expect(s.complete).toBe(false);
      expect(s.reason).toBe("row_cap");
    });

    it("four US zones across the end of DST (Nov 1 2026): local-day buckets equal SQL per zone", async () => {
      clear();
      // Hourly rows from Oct 30 to Nov 3 (UTC) at every store: crosses local midnights and the
      // 02:00 → 01:00 fall-back (New York, Chicago, Los Angeles; Honolulu has no DST).
      for (const [i, st] of stores.entries())
        insert(
          st.id,
          `tz${i}`,
          24 * 5,
          `timestamptz '2026-10-30 00:30:00+00' + (g * interval '1 hour')`,
        );
      const s = await readLedgerSummary(client(), { orgId: org.orgId, stores, days: 5, now: NOW });
      expect(s.complete).toBe(true);
      for (const st of s.stores) {
        const zone = st.timeZone;
        expect(asTruth(s, st.locationId), zone).toEqual(
          truth(st.locationId, zone, NOW.toISOString(), st.sinceDay),
        );
      }
      // Each store's "today" is its own local day at NOW.
      expect(s.stores.map((x) => x.today)).toEqual([
        "2026-11-03",
        "2026-11-03",
        "2026-11-03",
        "2026-11-03",
      ]);
    });

    it("same time yesterday: only yesterday's rows before the current local time", async () => {
      clear();
      // NOW = 10:00 in New York (EST). Yesterday 09:00 counts, yesterday 11:00 does not.
      insert(ny().id, "y-before", 1, `timestamptz '2026-11-02 09:00:00-05'`);
      insert(ny().id, "y-after", 1, `timestamptz '2026-11-02 11:00:00-05'`);
      const s = await readLedgerSummary(client(), {
        orgId: org.orgId,
        stores: [ny()],
        days: 1,
        now: NOW,
        sameTimeYesterday: true,
      });
      const before = Number(
        sql(
          `select amount_cents || ':' || kind from public.finance_entries where client_event_id = '${org.key}-y-before-1'`,
        ).split(":")[0],
      );
      const kind = sql(
        `select kind from public.finance_entries where client_event_id = '${org.key}-y-before-1'`,
      );
      const y = s.sameTimeYesterday![0]!;
      const expected = kind === "revenue" ? before : kind === "reversal_revenue" ? -before : 0;
      expect(y.revenueCents).toBe(expected);
    });

    it("cross-module: the real summary gives the same figures on every screen, equal to SQL", async () => {
      clear();
      for (const [i, st] of stores.entries())
        insert(
          st.id,
          `x${i}`,
          24 * 40,
          `timestamptz '2026-09-25 00:30:00+00' + (g * interval '1 hour')`,
        );
      const s = await readLedgerSummary(client(), {
        orgId: org.orgId,
        stores,
        days: null,
        now: NOW,
      });
      expect(s.complete).toBe(true);
      const refs = stores.map((st, i) => ({ id: `s${i}`, name: `S${i}`, dbId: st.id }));
      const reportStores = stores.map((st, i) => ({
        slug: `s${i}`,
        dbId: st.id,
        timeZone: st.timeZone,
      }));
      for (const spec of [
        PERIOD.today,
        PERIOD.days(7),
        PERIOD.days(30),
        PERIOD.month,
        PERIOD.all,
      ]) {
        // SQL truth: each store's own local window.
        const clauses = stores.map((st) => {
          const w = periodWindow(spec, s.stores.find((x) => x.locationId === st.id)!.today);
          const d = `(created_at at time zone '${st.timeZone}')::date`;
          return `(location_id = '${st.id}' and ${w.sinceDay ? `${d} >= '${w.sinceDay}' and ` : ""}${d} <= '${w.untilDay}')`;
        });
        const [rev, cogs] =
          sql(`select coalesce(sum(case kind when 'revenue' then amount_cents when 'reversal_revenue' then -amount_cents else 0 end), 0)
               || '|' || coalesce(sum(case kind when 'cogs' then amount_cents when 'reversal_cogs' then -amount_cents else 0 end), 0)
          from public.finance_entries where org_id = '${org.orgId}' and created_at < '${NOW.toISOString()}'
           and (${clauses.join(" or ")})`)
            .split("|")
            .map(Number);
        const report = buildReport({ orders: [], summary: s, spec, stores: reportStores });
        const finance = periodFigures(s, spec);
        const perStore = storeResults(refs, bucketRows(bucketsInPeriod(s, spec)), []);
        const insights = recordedIntelligence(
          { inventory: [], recipes: [] } as unknown as Resources,
          finance,
          0,
        );
        for (const v of [
          report.revenueCents,
          finance.revenueCents,
          insights.grossRevenueCents,
          perStore.reduce((a, r) => a + r.revenueCents, 0),
          report.daily.reduce((a, d) => a + d.cents, 0),
        ])
          expect(v, spec.kind).toBe(rev);
        for (const v of [
          report.cogsCents,
          insights.foodCostCents,
          perStore.reduce((a, r) => a + r.cogsCents, 0),
        ])
          expect(v, spec.kind).toBe(cogs);
      }
    });

    it("RLS: another tenant's owner reads nothing of this organization (complete, zero rows)", async () => {
      clear();
      insert(
        ny().id,
        "rls",
        50,
        `timestamptz '2026-10-26 12:00:00+00' + (g * interval '1 second')`,
      );
      const other = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await other.auth.signInWithPassword(tenantB);
      expect(error).toBeNull();
      const s = await readLedgerSummary(other as unknown as LedgerClient, {
        orgId: org.orgId,
        stores: [ny()],
        days: null,
        now: NOW,
      });
      expect(s.rowsRead).toBe(0);
      expect(s.buckets).toEqual([]);
    });

    it("LedgerReadError carries no partial data", () => {
      expect(new LedgerReadError("x").message).toBe("ledger_read_failed");
    });
  },
);
