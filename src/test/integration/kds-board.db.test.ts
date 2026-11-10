// Database integration test for the kitchen board. Runs only inside the security suite
// (scripts/qa/security-suite.sh), against the disposable QA stack and the synthetic QA tenant;
// skipped everywhere else.
//
// Production code path: fetchKitchenBoard over orderListQuery (the exact query of the
// fetchOperationalOrders server function, with its status filters), signed in as the QA owner so
// RLS applies; and the same realtime subscription the board opens (orders, org_id filter).
// Synthetic orders are inserted with SQL and removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  createClient,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "../../integrations/supabase/types";
import { orderListQuery } from "../../lib/orders-query";
import {
  KITCHEN_RECENT_DELIVERED,
  fetchKitchenBoard,
  type OrderPageRequest,
  type RecordedOrder,
} from "../../lib/recorded-data";

const ENABLED = process.env["QA_PAGING_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";
const OPEN = ["new", "confirmed", "in_prep", "ready"];

describe.skipIf(!ENABLED)(
  "kitchen board against the database (QA stack)",
  { timeout: 300_000 },
  () => {
    let creds: {
      orgId: string;
      locations: { downtown: string };
      owner: { email: string; password: string; userId: string };
      tenantB: { orgId: string };
    };
    let owner: SupabaseClient<Database>;

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

    /** `n` synthetic orders in `status`; `createdAt` is a SQL expression over the index `g`. */
    const insert = (
      tag: string,
      n: number,
      status: string,
      createdAt: string,
      org = creds.orgId,
      location = creds.locations.downtown,
    ) =>
      sql(`insert into public.orders(org_id, location_id, order_number, type, status, client_order_id, request_hash, created_by,
                                   subtotal_cents, total_cents, created_at, updated_at)
         select '${org}', '${location}', '#KDS-${tag}-' || g, 'takeout', '${status}', 'kds-${tag}-' || g, 'kds',
                '${creds.owner.userId}', 500, 500, ${createdAt}, ${createdAt}
         from generate_series(1, ${n}) g;`);
    const cleanup = () =>
      sql(`delete from public.order_status_history where order_id in (select id from public.orders where client_order_id like 'kds-%');
         delete from public.orders where client_order_id like 'kds-%';`);
    /** Open tickets straight from the table. */
    const openTruth = () =>
      sql(
        `select id from public.orders where org_id = '${creds.orgId}' and status in ('new','confirmed','in_prep','ready')`,
      )
        .split("\n")
        .filter(Boolean);

    const productionPages = async ({ data }: OrderPageRequest) => {
      const {
        data: rows,
        error,
        count,
      } = await orderListQuery(owner, {
        orgId: creds.orgId,
        offset: data.offset,
        limit: data.limit,
        status: data.status,
        statuses: data.statuses,
      });
      if (error) throw new Error(error.message);
      const orders = (rows ?? []).map((r) => ({ id: r.id, status: r.status }));
      return { orders: orders as unknown as RecordedOrder[], totalCount: count ?? 0 };
    };

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
    afterAll(async () => {
      if (owner) await owner.removeAllChannels();
      if (creds) cleanup();
    }, 120_000);

    it("150 open tickets behind 300 newer delivered orders: every open ticket once", async () => {
      insert("open", 150, "in_prep", "now() - interval '2 hours' - (g || ' seconds')::interval");
      insert("done", 300, "delivered", "now() - (g || ' seconds')::interval");
      const board = await fetchKitchenBoard(creds.orgId, "all", productionPages);
      const shownOpen = board.orders.filter((o) => OPEN.includes(o.status)).map((o) => o.id);
      const truth = openTruth();
      expect(truth.length).toBeGreaterThanOrEqual(150);
      expect(new Set(shownOpen).size, "duplicates").toBe(shownOpen.length);
      expect([...shownOpen].sort()).toEqual([...truth].sort());
      expect(board.orders.filter((o) => o.status === "delivered")).toHaveLength(
        KITCHEN_RECENT_DELIVERED,
      );
      expect(board).toMatchObject({ openTotal: truth.length, truncated: false });
      // The previous board (100 most recent orders of any status) would not show any of them.
      const old =
        sql(`select count(*) from (select status from public.orders where org_id = '${creds.orgId}'
                     order by created_at desc, id desc limit 100) s where status in ('new','confirmed','in_prep','ready')`);
      expect(Number(old)).toBe(0);
      cleanup();
    });

    it("450 open tickets (3 pages of the server maximum): each once", async () => {
      insert("many", 450, "new", "now() - (g || ' seconds')::interval");
      const board = await fetchKitchenBoard(creds.orgId, "all", productionPages);
      const shownOpen = board.orders.filter((o) => OPEN.includes(o.status)).map((o) => o.id);
      expect(new Set(shownOpen).size).toBe(shownOpen.length);
      expect([...shownOpen].sort()).toEqual([...openTruth()].sort());
      cleanup();
    });

    it("realtime: the board's subscription receives new tickets and status changes of its own org only", async () => {
      const events: RealtimePostgresChangesPayload<Record<string, unknown>>[] = [];
      const subscribed = new Promise<void>((resolve, reject) => {
        owner
          .channel(`kds-test-${Date.now()}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "orders", filter: `org_id=eq.${creds.orgId}` },
            (payload) => events.push(payload),
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") resolve();
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
              reject(new Error(status));
          });
      });
      await subscribed;
      const waitFor = async (pred: () => boolean, ms = 20_000) => {
        const end = Date.now() + ms;
        while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
        return pred();
      };

      insert("rt", 1, "new", "now()");
      const id = sql(`select id from public.orders where client_order_id = 'kds-rt-1'`);
      expect(
        await waitFor(() => events.some((e) => e.eventType === "INSERT" && e.new["id"] === id)),
      ).toBe(true);

      sql(`update public.orders set status = 'in_prep', updated_at = now() where id = '${id}'`);
      expect(
        await waitFor(() =>
          events.some(
            (e) => e.eventType === "UPDATE" && e.new["id"] === id && e.new["status"] === "in_prep",
          ),
        ),
      ).toBe(true);

      // A ticket of another organization never reaches this board.
      const bLoc = sql(
        `select id from public.locations where org_id = '${creds.tenantB.orgId}' limit 1`,
      );
      insert("rt-other", 1, "new", "now()", creds.tenantB.orgId, bLoc);
      const otherId = sql(`select id from public.orders where client_order_id = 'kds-rt-other-1'`);
      await new Promise((r) => setTimeout(r, 3000));
      expect(events.some((e) => (e.new as Record<string, unknown>)["id"] === otherId)).toBe(false);

      // The reload the event triggers shows the ticket in its new column.
      const board = await fetchKitchenBoard(creds.orgId, "all", productionPages);
      expect(board.orders.find((o) => o.id === id)?.status).toBe("in_prep");
      cleanup();
    });
  },
);
