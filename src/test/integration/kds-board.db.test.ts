// Database integration test for the kitchen board. Runs only inside the security suite
// (scripts/qa/security-suite.sh), against the disposable QA stack; skipped everywhere else.
//
// Production code path: fetchKitchenBoard over orderListQuery (the exact query of the
// fetchOperationalOrders server function, with its status filters), signed in as the QA owner so
// RLS applies; and the same realtime subscription the board opens (orders, org_id filter).
//
// Isolation: the test creates its OWN organization and store (unique key, the QA owner as its only
// member) plus a second organization the owner does not belong to, inserts synthetic orders only
// there, at fixed instants (never the wall clock, except the realtime events), and removes exactly
// those organizations at the end. Sales recorded by other tests or by people in the shared QA
// tenant cannot change any expectation, and the file can run in parallel with the others.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
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
import {
  countOrgRowsSql,
  createIsolatedOrgSql,
  dropIsolatedOrgsSql,
  isolatedOrg,
  type IsolatedOrg,
} from "../../../scripts/qa/isolated-org.mjs";
import { qaSql, T0, type QaSql } from "./qa-db";

const ENABLED = process.env["QA_PAGING_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";
const OPEN = ["new", "confirmed", "in_prep", "ready"];

describe.skipIf(!ENABLED)(
  "kitchen board against the database (QA stack)",
  { timeout: 300_000 },
  () => {
    let owner: SupabaseClient<Database>;
    let ownerUserId: string;
    let sql: QaSql;
    /** The board's organization (QA owner is its owner) and one the owner does not belong to. */
    let org: IsolatedOrg;
    let other: IsolatedOrg;

    /** `n` synthetic orders in `status`; `createdAt` is a SQL expression over the index `g`. */
    const insert = (tag: string, n: number, status: string, createdAt: string, into = org) =>
      sql(`insert into public.orders(org_id, location_id, order_number, type, status, client_order_id, request_hash, created_by,
                                   subtotal_cents, total_cents, created_at, updated_at)
         select '${into.orgId}', '${into.locationId}', '#KDS-${tag}-' || g, 'takeout', '${status}', '${into.key}-${tag}-' || g, 'kds',
                '${ownerUserId}', 500, 500, ${createdAt}, ${createdAt}
         from generate_series(1, ${n}) g;`);
    /** Removes the orders of THIS test's organizations only (between cases). */
    const clearOrders = () =>
      sql(`delete from public.order_status_history where org_id in ('${org.orgId}', '${other.orgId}');
           delete from public.orders where org_id in ('${org.orgId}', '${other.orgId}');`);
    /** Open tickets of the test organization, straight from the table. */
    const openTruth = () =>
      sql(
        `select id from public.orders where org_id = '${org.orgId}' and status in ('new','confirmed','in_prep','ready')`,
      )
        .split("\n")
        .filter(Boolean);
    const idOf = (clientOrderId: string) =>
      sql(`select id from public.orders where client_order_id = '${clientOrderId}'`);

    const productionPages = async ({ data }: OrderPageRequest) => {
      const {
        data: rows,
        error,
        count,
      } = await orderListQuery(owner, {
        orgId: org.orgId,
        offset: data.offset,
        limit: data.limit,
        status: data.status,
        statuses: data.statuses,
        oldestFirst: data.oldestFirst,
      });
      if (error) throw new Error(error.message);
      const orders = (rows ?? []).map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
      }));
      return { orders: orders as unknown as RecordedOrder[], totalCount: count ?? 0 };
    };

    beforeAll(async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(URL_))
        throw new Error("refusing: not the QA stack");
      const creds = JSON.parse(fs.readFileSync(process.env["CREDS_FILE"]!, "utf8")) as {
        owner: { email: string; password: string; userId: string };
      };
      ownerUserId = creds.owner.userId;
      sql = qaSql();
      org = isolatedOrg("kds", { members: [{ userId: ownerUserId, role: "owner" }] });
      other = isolatedOrg("kds-other");
      sql(createIsolatedOrgSql(org));
      sql(createIsolatedOrgSql(other));
      owner = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await owner.auth.signInWithPassword({
        email: creds.owner.email,
        password: creds.owner.password,
      });
      if (error) throw new Error("QA owner sign-in failed");
    }, 120_000);
    afterAll(async () => {
      if (owner) await owner.removeAllChannels();
      if (org && other) {
        sql(dropIsolatedOrgsSql([org.orgId, other.orgId]));
        expect(Number(sql(countOrgRowsSql([org.orgId, other.orgId]))), "left behind").toBe(0);
      }
    }, 120_000);

    it("150 open tickets behind 300 newer delivered orders: every open ticket once", async () => {
      insert("open", 150, "in_prep", `${T0} - interval '2 hours' - (g || ' seconds')::interval`);
      insert("done", 300, "delivered", `${T0} - (g || ' seconds')::interval`);
      const board = await fetchKitchenBoard(org.orgId, "all", productionPages);
      const shownOpen = board.orders.filter((o) => OPEN.includes(o.status)).map((o) => o.id);
      const truth = openTruth();
      expect(truth).toHaveLength(150);
      expect(new Set(shownOpen).size, "duplicates").toBe(shownOpen.length);
      expect([...shownOpen].sort()).toEqual([...truth].sort());
      expect(board.orders.filter((o) => o.status === "delivered")).toHaveLength(
        KITCHEN_RECENT_DELIVERED,
      );
      expect(board).toMatchObject({ openTotal: 150, openLoaded: 150, truncated: false });
      // The previous board (100 most recent orders of any status) would not show any of them: in
      // this organization the 100 newest orders are, by construction, delivered ones.
      const old =
        sql(`select count(*) from (select status from public.orders where org_id = '${org.orgId}'
                     order by created_at desc, id desc limit 100) s where status in ('new','confirmed','in_prep','ready')`);
      expect(Number(old)).toBe(0);
      clearOrders();
    });

    it("5,050 open tickets: the 5,000 that waited longest are on the board, the 50 newest reported", async () => {
      // g = 1 is the newest ticket, g = 5,050 the oldest
      insert("cap", 5050, "new", `${T0} - interval '1 hour' - (g || ' seconds')::interval`);
      const board = await fetchKitchenBoard(org.orgId, "all", productionPages);
      expect(openTruth()).toHaveLength(5050);
      expect(board).toMatchObject({ openTotal: 5050, openLoaded: 5000, truncated: true });
      const shown = new Set(board.orders.map((o) => o.id));
      const newest50 = sql(`select id from public.orders where org_id = '${org.orgId}'
        and status in ('new','confirmed','in_prep','ready') order by created_at desc, id desc limit 50`)
        .split("\n")
        .filter(Boolean);
      expect(newest50).toHaveLength(50);
      expect(
        newest50.filter((id) => shown.has(id)),
        "newest open tickets are the ones left out",
      ).toEqual([]);
      const oldest = sql(`select id from public.orders where org_id = '${org.orgId}'
        and status in ('new','confirmed','in_prep','ready') order by created_at asc, id asc limit 5000`)
        .split("\n")
        .filter(Boolean);
      expect(
        oldest.filter((id) => !shown.has(id)),
        "every long-waiting ticket is shown",
      ).toEqual([]);
      clearOrders();
    });

    it("450 open tickets (3 pages of the server maximum): each once", async () => {
      insert("many", 450, "new", `${T0} - (g || ' seconds')::interval`);
      const board = await fetchKitchenBoard(org.orgId, "all", productionPages);
      const shownOpen = board.orders.filter((o) => OPEN.includes(o.status)).map((o) => o.id);
      expect(shownOpen).toHaveLength(450);
      expect(new Set(shownOpen).size).toBe(shownOpen.length);
      expect([...shownOpen].sort()).toEqual([...openTruth()].sort());
      clearOrders();
    });

    it("realtime: the board's subscription receives new tickets and status changes of its own org only", async () => {
      const events: RealtimePostgresChangesPayload<Record<string, unknown>>[] = [];
      // The board's client authenticates realtime with the signed-in session, as in the app.
      const { data: session } = await owner.auth.getSession();
      await owner.realtime.setAuth(session.session?.access_token ?? null);
      const subscribed = new Promise<void>((resolve, reject) => {
        owner
          .channel(`${org.key}-rt`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "orders", filter: `org_id=eq.${org.orgId}` },
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
      // On a freshly started stack the realtime server starts streaming changes a few seconds
      // after the first subscription: insert warm-up tickets until one arrives (at most 90 s).
      let live = false;
      for (let i = 1; i <= 30 && !live; i++) {
        insert(`rt-warm${i}`, 1, "new", "now()");
        const warmId = idOf(`${org.key}-rt-warm${i}-1`);
        live = await waitFor(
          () => events.some((e) => (e.new as Record<string, unknown>)["id"] === warmId),
          3_000,
        );
      }
      expect(live, "realtime delivered no event for the organization's orders").toBe(true);

      insert("rt", 1, "new", "now()");
      const id = idOf(`${org.key}-rt-1`);
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

      // A ticket of another organization (the owner is not a member) never reaches this board.
      insert("rt-other", 1, "new", "now()", other);
      const otherId = idOf(`${other.key}-rt-other-1`);
      await new Promise((r) => setTimeout(r, 3000));
      expect(events.some((e) => (e.new as Record<string, unknown>)["id"] === otherId)).toBe(false);

      // The reload the event triggers shows the ticket in its new column.
      const board = await fetchKitchenBoard(org.orgId, "all", productionPages);
      expect(board.orders.find((o) => o.id === id)?.status).toBe("in_prep");
      clearOrders();
    });
  },
);
