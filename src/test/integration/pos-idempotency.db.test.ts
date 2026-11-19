// Database integration test for POS sale idempotency and reconciliation (wave 0). Runs only against
// a DISPOSABLE stack (QA_POS_DB=1 + target guard), never by default.
//
// Signed in as a real member (RLS and the sale RPC's own checks apply), it exercises the database
// protections the POS outbox relies on and the production lookup (src/lib/pos-sale-lookup.ts):
// a lost response resent with the same key, parallel duplicates, an edited ticket under the same
// key, definitive refusals and the lookup by key. Isolation: its own organization, removed at the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../integrations/supabase/types";
import { lookupSaleByKey } from "../../lib/pos-sale-lookup";
import { classifyAttempt, newSaleKey } from "../../lib/pos-outbox";
import {
  createIsolatedOrgSql,
  dropIsolatedOrgsSql,
  isolatedOrg,
  type IsolatedOrg,
} from "../../../scripts/qa/isolated-org.mjs";
import { disposableQa, dropPooledConnections, type QaSql } from "./qa-db";

const ENABLED = process.env["QA_POS_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";
const RATE = 88750;

describe.skipIf(!ENABLED)(
  "POS idempotency against the real sale RPC (disposable stack)",
  { timeout: 300_000 },
  () => {
    let client: SupabaseClient<Database>;
    let other: SupabaseClient<Database>;
    let sql: QaSql;
    let org: IsolatedOrg;

    const sale = (key: string, qty = 1, method = "cash", customer = "Wave 0") =>
      client.rpc("persist_finalized_pos_sale_atomic_v2", {
        _org_id: org.orgId,
        _location_id: org.locationId,
        _type: "takeout",
        _customer_name: customer,
        _customer_phone: "",
        _customer_email: "",
        _delivery_address: "",
        _table_number: "",
        _notes: "",
        _discount_cents: 0,
        _tax_rate_ppm: RATE,
        _is_simulation: false,
        _client_order_id: key,
        _items: [{ product_id: "w0-soda", quantity: qty, notes: "", modifiers: [] }],
        _payment_method: method,
      });
    const ordersFor = (key: string) =>
      Number(
        sql(
          `select count(*) from public.orders where org_id = '${org.orgId}' and client_order_id = '${key}'`,
        ),
      );
    const revenueRows = (key: string) =>
      Number(
        sql(`select count(*) from public.finance_entries f join public.orders o on o.id = f.order_id
                 where o.org_id = '${org.orgId}' and o.client_order_id = '${key}' and f.kind = 'revenue'`),
      );
    const lookup = (c: SupabaseClient<Database>, key: string) =>
      lookupSaleByKey(c, { orgId: org.orgId, locationId: org.locationId, clientOrderId: key });

    beforeAll(async () => {
      sql = await disposableQa(URL_, "test:pos-idempotency");
      const creds = JSON.parse(fs.readFileSync(process.env["CREDS_FILE"]!, "utf8")) as {
        owner: { email: string; password: string; userId: string };
        tenantB: { owner: { email: string; password: string } };
      };
      org = isolatedOrg("posidem", {
        members: [{ userId: creds.owner.userId, role: "owner" }],
        taxRatePpm: RATE,
        plan: "enterprise",
      });
      sql(createIsolatedOrgSql(org));
      sql(`insert into public.menu_products(org_id, client_id, name, price_cents, location_ids)
         values ('${org.orgId}', 'w0-soda', 'Wave0 Soda', 250, array['${org.locationId}'::uuid]);`);
      const signIn = async (who: { email: string; password: string }) => {
        const c = createClient<Database>(URL_, process.env["SB_ANON"]!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error } = await c.auth.signInWithPassword(who);
        if (error) throw new Error("sign-in failed");
        return c;
      };
      // the synchronous fixtures above blocked the event loop (see dropPooledConnections)
      dropPooledConnections();
      client = await signIn(creds.owner);
      other = await signIn(creds.tenantB.owner);
    }, 120_000);

    afterAll(() => {
      if (org) sql(dropIsolatedOrgsSql([org.orgId]));
    });

    it("lost response: the resend with the same key returns the SAME order (one order, one revenue row)", async () => {
      const key = newSaleKey();
      const first = await sale(key); // the response the register never received
      expect(first.error).toBeNull();
      const again = await sale(key);
      expect(again.error).toBeNull();
      expect(again.data).toBe(first.data);
      expect(ordersFor(key)).toBe(1);
      expect(revenueRows(key)).toBe(1);
      const found = await lookup(client, key);
      expect(found).toMatchObject({
        status: "found",
        orderId: first.data,
        paid: true,
        paymentMethod: "cash",
      });
    });

    it("ten parallel sends of one ticket (double taps, two tabs, retries): exactly one order", async () => {
      const key = newSaleKey();
      const results = await Promise.all(Array.from({ length: 10 }, () => sale(key)));
      expect(results.every((r) => r.error === null)).toBe(true);
      expect(new Set(results.map((r) => r.data)).size).toBe(1);
      expect(ordersFor(key)).toBe(1);
      expect(revenueRows(key)).toBe(1);
    });

    it("delayed duplicate after the ticket was edited: refused (idempotency_conflict), never a 2nd order", async () => {
      const key = newSaleKey();
      const original = await sale(key, 1);
      const edited = await sale(key, 2);
      expect(edited.error?.message).toBe("idempotency_conflict");
      expect(classifyAttempt(null, new Error(edited.error!.message))).toEqual({ kind: "conflict" });
      const otherMethod = await sale(key, 1, "card");
      expect(otherMethod.error?.message).toBe("idempotency_conflict");
      expect(ordersFor(key)).toBe(1);
      expect(
        (await lookup(client, key)).status === "found" && (await lookup(client, key)),
      ).toMatchObject({
        orderId: original.data,
      });
    });

    it("not found yet → resend with the same key records it once", async () => {
      const key = newSaleKey();
      expect(await lookup(client, key)).toEqual({ status: "not_found" });
      const r = await sale(key);
      expect(r.error).toBeNull();
      expect(await lookup(client, key)).toMatchObject({ status: "found", orderId: r.data });
      expect(ordersFor(key)).toBe(1);
    });

    it("a definitive refusal (tax rate changed) creates nothing under the key; the key stays usable", async () => {
      const key = newSaleKey();
      const refused = await client.rpc("persist_finalized_pos_sale_atomic_v2", {
        _org_id: org.orgId,
        _location_id: org.locationId,
        _type: "takeout",
        _customer_name: "Wave 0",
        _tax_rate_ppm: RATE + 1,
        _items: [{ product_id: "w0-soda", quantity: 1, notes: "", modifiers: [] }],
        _client_order_id: key,
        _payment_method: "cash",
        _discount_cents: 0,
        _is_simulation: false,
      });
      expect(refused.error?.message).toBe("tax_rate_changed");
      expect(classifyAttempt(null, new Error("tax_rate_changed"))).toEqual({
        kind: "refused",
        code: "tax_rate_changed",
      });
      expect(ordersFor(key)).toBe(0);
      expect(await lookup(client, key)).toEqual({ status: "not_found" });
    });

    it("a recorded then cancelled sale is reported as cancelled, and a resend creates nothing", async () => {
      const key = newSaleKey();
      const r = await sale(key);
      const c = await client.rpc("cancel_order_with_reversal", {
        _order_id: r.data!,
        _reason: "wave0 test",
      });
      expect(c.error).toBeNull();
      expect(await lookup(client, key)).toMatchObject({
        status: "found",
        orderStatus: "cancelled",
      });
      const resend = await sale(key);
      // Either the existing (cancelled, already paid) order id or order_cancelled — never a new order.
      expect(resend.error === null ? resend.data : resend.error.message).toSatisfy(
        (v: unknown) => v === r.data || v === "order_cancelled",
      );
      expect(ordersFor(key)).toBe(1);
    });

    it("RLS: another tenant can neither find the sale by key nor record under this organization", async () => {
      const key = newSaleKey();
      await sale(key);
      expect(await lookup(other, key)).toEqual({ status: "not_found" });
      const intrusion = await other.rpc("persist_finalized_pos_sale_atomic_v2", {
        _org_id: org.orgId,
        _location_id: org.locationId,
        _type: "takeout",
        _customer_name: "Wave 0",
        _tax_rate_ppm: RATE,
        _items: [{ product_id: "w0-soda", quantity: 1, notes: "", modifiers: [] }],
        _client_order_id: key,
        _payment_method: "cash",
        _discount_cents: 0,
        _is_simulation: false,
      });
      expect(intrusion.error).not.toBeNull();
      expect(ordersFor(key)).toBe(1);
    });

    it("0036: the basis-point sale RPCs are not callable through the API (no alternative path to a key), signed in or not", async () => {
      const key = newSaleKey();
      const first = await sale(key);
      expect(first.error).toBeNull();
      const anon = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const legacyArgs = (k: string) => ({
        _org_id: org.orgId,
        _location_id: org.locationId,
        _type: "takeout" as const,
        _customer_name: "Wave 0",
        _tax_rate_basis_points: RATE / 100,
        _items: [{ product_id: "w0-soda", quantity: 1, notes: "", modifiers: [] }],
        _client_order_id: k,
      });
      const fresh = newSaleKey();
      for (const [who, c] of [
        ["owner", client],
        ["anon", anon],
      ] as const)
        for (const k of [key, fresh]) {
          const a = await c.rpc("create_pos_sale", legacyArgs(k));
          const b = await c.rpc("finalize_pos_sale_atomic", {
            ...legacyArgs(k),
            _payment_method: "cash",
          });
          const d = await c.rpc("persist_finalized_pos_sale_atomic", {
            ...legacyArgs(k),
            _payment_method: "cash",
          });
          for (const r of [a, b, d]) {
            expect(r.data, who).toBeNull();
            expect(r.error?.code, who).toBe("42501");
          }
        }
      // nothing was recorded through them, and the current flow is unaffected
      expect(ordersFor(fresh)).toBe(0);
      expect(ordersFor(key)).toBe(1);
      const again = await sale(key);
      expect(again.data).toBe(first.data);
    });

    it("a failed lookup throws (it is never reported as 'not found')", async () => {
      const broken = createClient<Database>("http://127.0.0.1:9", process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await expect(lookup(broken, newSaleKey())).rejects.toThrow("sale_lookup_failed");
    });
  },
);
