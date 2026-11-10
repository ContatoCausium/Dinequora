// Database integration test for the order history used by Finance, Reports, Orders, Locations and
// the Overview. Runs only inside the security suite (scripts/qa/security-suite.sh), against the
// disposable QA stack and the synthetic QA tenant; skipped everywhere else.
//
// It exercises the production code path: fetchAllOrders paging over orderListQuery (the exact query
// of the fetchOperationalOrders server function), signed in as the QA owner so RLS applies.
// Synthetic orders are inserted with SQL and removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../integrations/supabase/types";
import { orderListQuery } from "../../lib/orders-query";
import { fetchAllOrders, type RecordedOrder } from "../../lib/recorded-data";

const ENABLED = process.env["QA_PAGING_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";

describe.skipIf(!ENABLED)(
  "order history against the database (QA stack)",
  { timeout: 300_000 },
  () => {
    let creds: {
      orgId: string;
      locations: { downtown: string };
      owner: { email: string; password: string; userId: string };
    };
    let owner: SupabaseClient<Database>;

    // psql on the CI runner, otherwise the one inside the QA database container.
    const sql = (q: string): string => {
      const args = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", q];
      const out =
        process.env["QA_DB_URL"] && hasPsql()
          ? execFileSync("psql", [process.env["QA_DB_URL"], ...args])
          : execFileSync("docker", [
              "exec",
              "-i",
              `supabase_db_${process.env["QA_PROJECT"]}`,
              "psql",
              "-U",
              "postgres",
              "-d",
              "postgres",
              ...args,
            ]);
      return out.toString().trim();
    };
    function hasPsql() {
      try {
        execFileSync("psql", ["--version"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    }

    /** `n` synthetic orders; `createdAt` is a SQL expression over the series index `g`. */
    const insert = (tag: string, n: number, createdAt: string) =>
      sql(`insert into public.orders(org_id, location_id, order_number, type, status, client_order_id, request_hash, created_by,
                                   subtotal_cents, total_cents, created_at, updated_at)
         select '${creds.orgId}', '${creds.locations.downtown}', '#PG-${tag}-' || g, 'takeout', 'delivered', 'paging-${tag}-' || g, 'paging',
                '${creds.owner.userId}', 100 + g % 37, 100 + g % 37, ${createdAt}, ${createdAt}
         from generate_series(1, ${n}) g;`);
    const cleanup = () =>
      sql(`delete from public.order_status_history where order_id in (select id from public.orders where client_order_id like 'paging-%');
         delete from public.orders where client_order_id like 'paging-%';`);
    /** Ground truth straight from the table (id, total), newest first. */
    const truth = (limit?: number) =>
      sql(`select id || ':' || total_cents from public.orders where org_id = '${creds.orgId}'
         order by created_at desc, id desc ${limit ? `limit ${limit}` : ""}`)
        .split("\n")
        .filter(Boolean)
        .map((l) => ({ id: l.split(":")[0]!, totalCents: Number(l.split(":")[1]) }));

    const productionPages =
      (afterEach?: (offset: number) => void) =>
      async (req: { data: { offset: number; limit: number } }) => {
        const { data, error, count } = await orderListQuery(owner, {
          orgId: creds.orgId,
          offset: req.data.offset,
          limit: req.data.limit,
        });
        if (error) throw new Error(error.message);
        afterEach?.(req.data.offset);
        const orders = (data ?? []).map((r) => ({ id: r.id, totalCents: r.total_cents }));
        return { orders: orders as unknown as RecordedOrder[], totalCount: count ?? 0 };
      };

    function exactlyOnce(loaded: RecordedOrder[], expected: { id: string; totalCents: number }[]) {
      const ids = loaded.map((o) => o.id);
      expect(new Set(ids).size, "duplicates").toBe(ids.length);
      const want = new Set(expected.map((e) => e.id));
      expect(
        ids.filter((id) => !want.has(id)),
        "unexpected orders",
      ).toEqual([]);
      expect(
        expected.filter((e) => !ids.includes(e.id)).map((e) => e.id),
        "missing orders",
      ).toEqual([]);
      const total = (xs: { totalCents: number }[]) => xs.reduce((s, x) => s + x.totalCents, 0);
      expect(total(loaded as unknown as { totalCents: number }[]), "sum of totals").toBe(
        total(expected),
      );
    }

    beforeAll(async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(URL_))
        throw new Error("refusing: not the QA stack");
      creds = JSON.parse(fs.readFileSync(process.env["CREDS_FILE"]!, "utf8"));
      owner = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await owner.auth.signInWithPassword({
        email: creds.owner.email,
        password: creds.owner.password,
      });
      if (error) throw new Error("QA owner sign-in failed");
      cleanup();
    }, 120_000);
    afterAll(() => {
      if (creds) cleanup();
    }, 120_000);

    it("450 orders with distinct times: 3 pages, each order once, totals match", async () => {
      insert("distinct", 450, "now() - (g || ' seconds')::interval");
      const r = await fetchAllOrders(creds.orgId, "all", undefined, productionPages());
      exactlyOnce(r.orders, truth());
      expect(r.truncated).toBe(false);
      cleanup();
    });

    it("458 orders created in the same instant: each once (the tie that duplicated/omitted before)", async () => {
      insert("tie", 458, "timestamptz '2026-11-01 12:00:00+00'");
      const r = await fetchAllOrders(creds.orgId, "all", undefined, productionPages());
      exactlyOnce(r.orders, truth());
      cleanup();
    });

    it("5,200 orders: stops at the 5,000 newest, each once, truncated", async () => {
      const base = truth().length;
      insert("cap", 5200 - base, "now() - (g || ' seconds')::interval");
      const r = await fetchAllOrders(creds.orgId, "all", undefined, productionPages());
      expect(r.total).toBe(5200);
      expect(r.truncated).toBe(true);
      exactlyOnce(r.orders, truth(5000));
      cleanup();
    });

    it("a sale created between pages: nothing counted twice, nothing recorded lost", async () => {
      insert("shift", 450, "now() - (g || ' seconds')::interval");
      const before = truth();
      let done = false;
      const r = await fetchAllOrders(
        creds.orgId,
        "all",
        undefined,
        productionPages((offset) => {
          if (offset === 0 && !done) {
            done = true;
            insert("shift-late", 1, "now() + interval '1 second'");
          }
        }),
      );
      const ids = r.orders.map((o) => o.id);
      expect(new Set(ids).size, "duplicates").toBe(ids.length);
      for (const o of before) expect(ids).toContain(o.id);
      expect(r.truncated).toBe(false);
      cleanup();
    });
  },
);
