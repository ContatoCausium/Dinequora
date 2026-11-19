// Database integration test for the manual resolution of a pending POS sale (migration 0032).
// Runs only against a DISPOSABLE stack (QA_PENDING_DB=1 + target guard), never by default.
//
// Real members sign in (RLS and the RPC's own checks apply). The isolated organization has two
// stores; members: owner, manager (store A only, no grant by default), staff cashier (store A),
// an organization admin (manager tier with the org_admin system profile, store A).
// The two-session race (sale vs resolution, both orders) is scripts/security/pos_pending_resolution_race.mjs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
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
import { disposableQa, type QaSql } from "./qa-db";

const ENABLED = process.env["QA_PENDING_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";
const RATE = 88750;
type Who = { email: string; password: string; userId: string };
type Creds = {
  owner: Who;
  admin: Who;
  team: { manager: Who };
  roles: Record<string, { userId: string; password: string }>;
  tenantB: { owner: Who };
};

describe.skipIf(!ENABLED)(
  "manual resolution of a pending POS sale (disposable stack)",
  { timeout: 300_000 },
  () => {
    let sql: QaSql;
    let org: IsolatedOrg;
    let storeB: string;
    let creds: Creds;
    const c: Record<string, SupabaseClient<Database>> = {};
    let managerMemberId: string;

    const signIn = async (who: { email: string; password: string }) => {
      const cl = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await cl.auth.signInWithPassword(who);
      if (error) throw new Error("sign-in failed");
      return cl;
    };
    const role = (prefix: string) => {
      const [email, v] = Object.entries(creds.roles).find(([e]) => e.startsWith(prefix))!;
      return { email, password: v.password, userId: v.userId };
    };
    const sale = (cl: SupabaseClient<Database>, key: string, location = org.locationId) =>
      cl.rpc("persist_finalized_pos_sale_atomic_v2", {
        _org_id: org.orgId,
        _location_id: location,
        _type: "takeout",
        _customer_name: "Pending test",
        _customer_phone: "",
        _customer_email: "",
        _delivery_address: "",
        _table_number: "",
        _notes: "",
        _discount_cents: 0,
        _tax_rate_ppm: RATE,
        _is_simulation: false,
        _client_order_id: key,
        _items: [{ product_id: "pr-soda", quantity: 1, notes: "", modifiers: [] }],
        _payment_method: "cash",
      });
    const resolve = (
      cl: SupabaseClient<Database>,
      key: string,
      reason = "Customer left without paying; cash drawer checked",
      location = org.locationId,
    ) =>
      cl.rpc("resolve_pending_pos_sale", {
        _org_id: org.orgId,
        _location_id: location,
        _client_order_id: key,
        _reason: reason,
        _amount_cents: 299,
        _attempts: 3,
        _last_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      });
    const count = (q: string) => Number(sql(q));
    const orders = (key: string) =>
      count(
        `select count(*) from public.orders where org_id = '${org.orgId}' and client_order_id = '${key}'`,
      );
    const voids = (key: string) =>
      count(
        `select count(*) from public.pos_sale_key_voids where org_id = '${org.orgId}' and client_order_id = '${key}'`,
      );
    const audit = (key: string) =>
      sql(`select action || '|' || coalesce(actor_id::text,'') || '|' || coalesce(location_id::text,'') || '|' || target || '|' || coalesce(metadata->>'reason','') || '|' || (created_at is not null)
             from public.audit_logs where org_id = '${org.orgId}' and target = '${key}' and action like 'pos.pending_sale_%' order by created_at`)
        .split("\n")
        .filter(Boolean);

    beforeAll(async () => {
      sql = await disposableQa(URL_, "test:pos-pending-resolution");
      creds = JSON.parse(fs.readFileSync(process.env["CREDS_FILE"]!, "utf8")) as Creds;
      const adminUser = role("stock"); // becomes this org's organization admin (org_admin profile)
      org = isolatedOrg("pendres", {
        members: [
          { userId: creds.owner.userId, role: "owner" },
          { userId: creds.team.manager.userId, role: "manager", store: true },
          { userId: role("cashier").userId, role: "staff", store: true },
          { userId: adminUser.userId, role: "manager", store: true },
        ],
        taxRatePpm: RATE,
        plan: "enterprise",
      });
      sql(createIsolatedOrgSql(org));
      storeB = crypto.randomUUID();
      sql(`insert into public.locations(id, org_id, slug, name, address, tax_rate_ppm)
           values ('${storeB}', '${org.orgId}', 't_${org.key}_b', 'Store B', '1 Test Street', ${RATE});`);
      sql(`insert into public.menu_products(org_id, client_id, name, price_cents, location_ids)
           values ('${org.orgId}', 'pr-soda', 'Pending Soda', 275, array['${org.locationId}'::uuid, '${storeB}'::uuid]);`);
      sql(`update public.organization_members set profile_id = (select id from public.permission_profiles where is_system and key = 'org_admin')
            where org_id = '${org.orgId}' and user_id = '${adminUser.userId}';
           update public.organization_members
              set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions)
            where org_id = '${org.orgId}';`);
      managerMemberId = sql(
        `select id from public.organization_members where org_id = '${org.orgId}' and user_id = '${creds.team.manager.userId}'`,
      );
      c["owner"] = await signIn(creds.owner);
      c["manager"] = await signIn(creds.team.manager);
      c["cashier"] = await signIn(role("cashier"));
      c["orgAdmin"] = await signIn(adminUser);
      c["platformAdmin"] = await signIn(creds.admin);
      c["otherTenant"] = await signIn(creds.tenantB.owner);
    }, 180_000);

    afterAll(() => {
      if (org) sql(dropIsolatedOrgsSql([org.orgId]));
    });

    it("the sale exists: nothing is closed, the order is returned and the recovery is audited", async () => {
      const key = newSaleKey();
      const s = await sale(c["owner"]!, key);
      expect(s.error).toBeNull();
      const r = await resolve(c["owner"]!, key);
      expect(r.error).toBeNull();
      expect(r.data).toMatchObject({ status: "recorded", order_id: s.data, paid: true });
      expect(voids(key)).toBe(0);
      expect(orders(key)).toBe(1);
      const a = audit(key);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatch(
        new RegExp(
          `^pos\\.pending_sale_recovered\\|${creds.owner.userId}\\|${org.locationId}\\|${key}\\|Customer left`,
        ),
      );
    });

    it("no sale: the key is closed for good, audited (actor, store, key, time, reason), and a later sale is refused", async () => {
      const key = newSaleKey();
      const r = await resolve(c["owner"]!, key);
      expect(r.error).toBeNull();
      expect(r.data).toMatchObject({ status: "resolved" });
      expect(voids(key)).toBe(1);
      expect(
        sql(`select actor_id || '|' || location_id || '|' || reason || '|' || amount_cents || '|' || attempts || '|' || (last_attempt_at is not null)
               from public.pos_sale_key_voids where org_id = '${org.orgId}' and client_order_id = '${key}'`),
      ).toBe(
        `${creds.owner.userId}|${org.locationId}|Customer left without paying; cash drawer checked|299|3|true`,
      );
      expect(audit(key)).toEqual([
        `pos.pending_sale_resolved|${creds.owner.userId}|${org.locationId}|${key}|Customer left without paying; cash drawer checked|true`,
      ]);
      // A request still travelling on the network arrives now: refused, never recorded.
      const late = await sale(c["owner"]!, key);
      expect(late.error?.message).toBe("sale_key_voided");
      expect(classifyAttempt(null, new Error(late.error!.message))).toEqual({ kind: "voided" });
      expect(orders(key)).toBe(0);
      // The register's lookup sees the closed key.
      const found = await lookupSaleByKey(c["owner"]!, {
        orgId: org.orgId,
        locationId: org.locationId,
        clientOrderId: key,
      });
      expect(found).toMatchObject({ status: "resolved" });
    });

    it("resolving again is idempotent (already_resolved) and writes nothing new", async () => {
      const key = newSaleKey();
      await resolve(c["owner"]!, key);
      const again = await resolve(c["owner"]!, key, "Second click on the same pending sale");
      expect(again.data).toMatchObject({ status: "already_resolved" });
      expect(voids(key)).toBe(1);
      expect(audit(key)).toHaveLength(1);
    });

    it("permissions: owner and organization admin yes; manager only with an explicit grant and only at its store; staff, platform admin and other tenant never", async () => {
      const k = () => newSaleKey();
      expect((await resolve(c["owner"]!, k())).error).toBeNull();
      expect((await resolve(c["orgAdmin"]!, k())).error).toBeNull();

      const mk = k();
      expect((await resolve(c["manager"]!, mk)).error?.message).toBe("permission_denied");
      expect(voids(mk)).toBe(0);
      // explicit grant to the manager
      sql(`update public.organization_members set extra_permissions = array['orders.resolve_pending'],
                  effective_permissions = public.effective_permissions_for(role, profile_id, array['orders.resolve_pending'], revoked_permissions)
            where id = '${managerMemberId}';`);
      try {
        expect((await resolve(c["manager"]!, k())).error).toBeNull();
        // granted, but store B is not one of its stores
        const other = k();
        expect((await resolve(c["manager"]!, other, undefined, storeB)).error?.message).toBe(
          "permission_denied",
        );
        expect(voids(other)).toBe(0);
      } finally {
        sql(`update public.organization_members set extra_permissions = '{}',
                    effective_permissions = public.effective_permissions_for(role, profile_id, '{}', revoked_permissions)
              where id = '${managerMemberId}';`);
      }

      // staff: even an explicit grant is cut by the tier ceiling
      sql(`update public.organization_members set extra_permissions = array['orders.resolve_pending'],
                  effective_permissions = public.effective_permissions_for(role, profile_id, array['orders.resolve_pending'], revoked_permissions)
            where org_id = '${org.orgId}' and role = 'staff';`);
      expect(
        sql(
          `select 'orders.resolve_pending' = any(effective_permissions) from public.organization_members where org_id = '${org.orgId}' and role = 'staff'`,
        ),
      ).toBe("f");
      const sk = k();
      expect((await resolve(c["cashier"]!, sk)).error?.message).toBe("permission_denied");
      expect(voids(sk)).toBe(0);

      for (const who of ["platformAdmin", "otherTenant"]) {
        const key = k();
        expect((await resolve(c[who]!, key)).error?.message, who).toBe("forbidden");
        expect(voids(key)).toBe(0);
      }
      const anon = createClient<Database>(URL_, process.env["SB_ANON"]!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await resolve(anon, k())).error).not.toBeNull();
    });

    it("refuses without writing anything: short justification, empty key, store of another organization", async () => {
      const key = newSaleKey();
      expect((await resolve(c["owner"]!, key, "too short")).error?.message).toBe("reason_required");
      expect((await resolve(c["owner"]!, "   ")).error?.message).toBe("invalid_key");
      expect((await resolve(c["owner"]!, key, undefined, crypto.randomUUID())).error?.message).toBe(
        "location_forbidden",
      );
      expect(voids(key)).toBe(0);
      expect(audit(key)).toEqual([]);
    });

    it("0033 (B4): a justification made only of whitespace or invisible characters is refused; the stored one is trimmed", async () => {
      const key = newSaleKey();
      for (const blank of [
        "\t".repeat(12),
        "\n\r\t \n\r\t \n\r\t",
        "\u00a0".repeat(12),
        "\u200b\u200c\u200d\u2060\ufeff".repeat(3),
        "\u3000\u2003\u202f\u205f".repeat(3),
      ]) {
        expect((await resolve(c["owner"]!, key, blank)).error?.message).toBe("reason_required");
      }
      // 9 visible characters padded with invisible ones is still too short
      expect((await resolve(c["owner"]!, key, "\u00a0\t123456789\u200b\n")).error?.message).toBe(
        "reason_required",
      );
      expect(voids(key)).toBe(0);
      expect(audit(key)).toEqual([]);
      const r = await resolve(c["owner"]!, key, "\u00a0\t Customer left; drawer checked \u200b\n");
      expect(r.error).toBeNull();
      expect(
        sql(
          `select reason from public.pos_sale_key_voids where org_id = '${org.orgId}' and client_order_id = '${key}'`,
        ),
      ).toBe("Customer left; drawer checked");
    });

    it("closed keys are visible only inside the organization (RLS); nobody can write them directly", async () => {
      const key = newSaleKey();
      await resolve(c["owner"]!, key);
      const mine = await c["cashier"]!.from("pos_sale_key_voids")
        .select("client_order_id")
        .eq("client_order_id", key);
      expect(mine.data).toHaveLength(1);
      const other = await c["otherTenant"]!.from("pos_sale_key_voids")
        .select("client_order_id")
        .eq("client_order_id", key);
      expect(other.data).toEqual([]);
      const insert = await c["owner"]!.from("pos_sale_key_voids").insert({
        org_id: org.orgId,
        client_order_id: newSaleKey(),
        location_id: org.locationId,
        actor_id: creds.owner.userId,
        reason: "direct insert attempt",
      });
      expect(insert.error).not.toBeNull();
      const del = await c["owner"]!.from("pos_sale_key_voids")
        .delete()
        .eq("client_order_id", key)
        .select();
      expect(del.data ?? []).toEqual([]);
      expect(voids(key)).toBe(1);
    });

    it("the sale function is unchanged apart from the closed-key check (same privileges, same idempotency)", async () => {
      const key = newSaleKey();
      const first = await sale(c["cashier"]!, key);
      const again = await sale(c["cashier"]!, key);
      expect(first.error).toBeNull();
      expect(again.data).toBe(first.data);
      expect(orders(key)).toBe(1);
      expect(
        sql(`select has_function_privilege('authenticated', 'public.create_pos_sale_v2(uuid,uuid,order_type,text,text,text,text,text,text,integer,integer,jsonb,boolean,text)', 'execute')
                 || '|' || has_function_privilege('anon', 'public.create_pos_sale_v2(uuid,uuid,order_type,text,text,text,text,text,text,integer,integer,jsonb,boolean,text)', 'execute')`),
      ).toBe("true|false");
    });
  },
);
