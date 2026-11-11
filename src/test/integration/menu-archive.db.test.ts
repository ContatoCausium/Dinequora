// Database integration test for archiving menu categories (migration 0026). Runs only inside the
// security suite (scripts/qa/security-suite.sh), against the disposable QA stack; skipped
// everywhere else.
//
// Production code path: the archive_operational_menu RPC called through PostgREST with the exact
// arguments of the archiveOperationalMenu server function, by signed-in members (RLS and grants
// apply), and the category list read with the query of the fetchOperationalMenu server function
// (active categories of the organization, by name).
//
// Isolation: the test creates its OWN organization and store (the QA owner as owner, the QA
// manager as manager and the QA kitchen staff as staff, both with the store) plus a second
// organization owned by the tenant-B owner that uses the SAME category client id; it writes menu
// rows only there and removes exactly those organizations at the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../integrations/supabase/types";
import {
  countOrgRowsSql,
  createIsolatedOrgSql,
  dropIsolatedOrgsSql,
  isolatedOrg,
  type IsolatedOrg,
} from "../../../scripts/qa/isolated-org.mjs";
import { qaSql, type QaSql } from "./qa-db";

const ENABLED = process.env["QA_PAGING_DB"] === "1";
const URL_ = process.env["SB_URL"] ?? "";

type Account = { email: string; password: string; userId: string };
type Creds = {
  owner: Account;
  team: { manager: Account };
  emails: Record<string, string>;
  roles: Record<string, { userId: string; password: string }>;
  tenantB: { owner: Account };
};

async function signIn(email: string, password: string): Promise<SupabaseClient<Database>> {
  const c = createClient<Database>(URL_, process.env["SB_ANON"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return c;
}

// Same call as archiveOperationalMenu (src/lib/operational.functions.ts).
const archive = (
  c: SupabaseClient<Database>,
  orgId: string,
  kind: "category" | "product",
  id: string,
) => c.rpc("archive_operational_menu", { _org_id: orgId, _kind: kind, _client_id: id });
const save = (
  c: SupabaseClient<Database>,
  orgId: string,
  kind: "category" | "product",
  payload: Json,
) => c.rpc("save_operational_menu", { _org_id: orgId, _kind: kind, _payload: payload as Json });
// Same query as the category list of fetchOperationalMenu.
const visibleCategories = async (c: SupabaseClient<Database>, orgId: string) => {
  const { data, error } = await c
    .from("menu_categories")
    .select("*")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.client_id);
};

describe.skipIf(!ENABLED)("menu category archive against the database (0026)", () => {
  let sql: QaSql;
  let org: IsolatedOrg;
  let other: IsolatedOrg;
  let owner: SupabaseClient<Database>;
  let manager: SupabaseClient<Database>;
  let staff: SupabaseClient<Database>;
  let ownerB: SupabaseClient<Database>;
  let ownerUserId: string;

  const product = (id: string, category: string, active = true) => ({
    id,
    name: id,
    category,
    priceCents: 300,
    prepTimeMinutes: 2,
    locationIds: [],
    modifierGroups: [],
    active,
  });
  const productRows = () =>
    sql(`select coalesce(json_agg(json_build_object('client_id', client_id, 'category_id', category_id, 'active', active,
                'price_cents', price_cents, 'name', name, 'updated_at', updated_at) order by client_id), '[]')
           from public.menu_products where org_id = '${org.orgId}'`);
  const auditCount = (target: string, orgId = org.orgId) =>
    Number(
      sql(`select count(*) from public.audit_logs where org_id = '${orgId}' and action = 'menu.archived'
             and target = '${target}' and metadata->>'kind' = 'category'`),
    );

  beforeAll(async () => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(URL_))
      throw new Error("refusing: not the QA stack");
    const creds = JSON.parse(fs.readFileSync(process.env["CREDS_FILE"]!, "utf8")) as Creds;
    const kitchen = creds.roles[creds.emails["kitchen"]!]!;
    ownerUserId = creds.owner.userId;
    sql = qaSql();
    org = isolatedOrg("menu", {
      members: [
        { userId: creds.owner.userId, role: "owner" },
        { userId: creds.team.manager.userId, role: "manager", store: true },
        { userId: kitchen.userId, role: "staff", store: true },
      ],
    });
    other = isolatedOrg("menu-other", {
      members: [{ userId: creds.tenantB.owner.userId, role: "owner" }],
    });
    sql(createIsolatedOrgSql(org));
    sql(createIsolatedOrgSql(other));
    owner = await signIn(creds.owner.email, creds.owner.password);
    manager = await signIn(creds.team.manager.email, creds.team.manager.password);
    staff = await signIn(creds.emails["kitchen"]!, kitchen.password);
    ownerB = await signIn(creds.tenantB.owner.email, creds.tenantB.owner.password);

    for (const [id, name] of [
      ["drinks", "Drinks"],
      ["desserts", "Desserts"],
      ["seasonal", "Seasonal"],
    ] as const) {
      const { error } = await save(owner, org.orgId, "category", { id, name });
      expect(error, `category ${id}`).toBeNull();
    }
    for (const p of [
      product("soda", "drinks"),
      product("cake", "desserts", false),
      product("pie", "desserts", false),
    ]) {
      const { error } = await save(owner, org.orgId, "product", p);
      expect(error, `product ${p.id}`).toBeNull();
    }
    const { error } = await save(ownerB, other.orgId, "category", {
      id: "drinks",
      name: "B Drinks",
    });
    expect(error).toBeNull();
  }, 120_000);

  afterAll(async () => {
    for (const c of [owner, manager, staff, ownerB]) if (c) await c.auth.signOut();
    if (org && other) {
      sql(dropIsolatedOrgsSql([org.orgId, other.orgId]));
      expect(Number(sql(countOrgRowsSql([org.orgId, other.orgId]))), "left behind").toBe(0);
    }
  }, 120_000);

  it("the owner archives an empty category: it leaves the menu and one audit row is recorded", async () => {
    expect(await visibleCategories(owner, org.orgId)).toEqual(["desserts", "drinks", "seasonal"]);
    const { error } = await archive(owner, org.orgId, "category", "seasonal");
    expect(error).toBeNull();
    expect(await visibleCategories(owner, org.orgId)).toEqual(["desserts", "drinks"]);
    expect(auditCount("seasonal")).toBe(1);
    expect(
      sql(
        `select actor_id from public.audit_logs where org_id = '${org.orgId}' and action = 'menu.archived' and target = 'seasonal'`,
      ),
    ).toBe(ownerUserId);
  });

  it("archiving it again succeeds and changes nothing", async () => {
    const { error } = await archive(owner, org.orgId, "category", "seasonal");
    expect(error).toBeNull();
    expect(await visibleCategories(owner, org.orgId)).toEqual(["desserts", "drinks"]);
  });

  it("a category that does not exist is refused and nothing is written", async () => {
    const { error } = await archive(owner, org.orgId, "category", "no-such-category");
    expect(error?.message).toBe("not_found");
    expect(auditCount("no-such-category")).toBe(0);
  });

  it("a category with an active product stays on the menu", async () => {
    const { error } = await archive(owner, org.orgId, "category", "drinks");
    expect(error?.message).toBe("category_in_use");
    expect(await visibleCategories(owner, org.orgId)).toContain("drinks");
  });

  it("a category whose products are all unavailable is archived and its products are untouched", async () => {
    const before = productRows();
    const { error } = await archive(owner, org.orgId, "category", "desserts");
    expect(error).toBeNull();
    expect(await visibleCategories(owner, org.orgId)).toEqual(["drinks"]);
    expect(productRows()).toBe(before);
  });

  it("manager and staff cannot archive a category; nothing changes", async () => {
    const m = await archive(manager, org.orgId, "category", "drinks");
    expect(m.error?.message).toBe("forbidden");
    const s = await archive(staff, org.orgId, "category", "drinks");
    expect(s.error?.message).toBe("permission_denied");
    expect(await visibleCategories(owner, org.orgId)).toEqual(["drinks"]);
    // staff still reads the menu through RLS
    expect(await visibleCategories(staff, org.orgId)).toEqual(["drinks"]);
  });

  it("organizations are isolated even with the same category client id", async () => {
    const intruder = await archive(owner, other.orgId, "category", "drinks");
    expect(intruder.error?.message).toBe("forbidden");
    const { error } = await archive(ownerB, other.orgId, "category", "drinks");
    expect(error).toBeNull();
    expect(await visibleCategories(ownerB, other.orgId)).toEqual([]);
    // the category "drinks" of the test organization is still there
    expect(await visibleCategories(owner, org.orgId)).toEqual(["drinks"]);
    expect(auditCount("drinks", other.orgId)).toBe(1);
    expect(auditCount("drinks")).toBe(0);
  });

  it("menu regressions: archive a product, then its category; re-saving a category restores it", async () => {
    const p = await archive(owner, org.orgId, "product", "soda");
    expect(p.error).toBeNull();
    const c = await archive(owner, org.orgId, "category", "drinks");
    expect(c.error).toBeNull();
    expect(await visibleCategories(owner, org.orgId)).toEqual([]);
    const blocked = await save(owner, org.orgId, "product", product("tea", "drinks"));
    expect(blocked.error?.message).toBe("category_required");
    const restore = await save(owner, org.orgId, "category", { id: "drinks", name: "Drinks" });
    expect(restore.error).toBeNull();
    const back = await save(owner, org.orgId, "product", product("soda", "drinks"));
    expect(back.error).toBeNull();
    expect(await visibleCategories(owner, org.orgId)).toEqual(["drinks"]);
    expect(
      sql(
        `select active from public.menu_products where org_id = '${org.orgId}' and client_id = 'soda'`,
      ),
    ).toBe("t");
  });
});
