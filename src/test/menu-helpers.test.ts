import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { menuAbilities, type MenuStore } from "@/lib/menu-abilities";
import {
  canArchiveCategory,
  categoryIdFromName,
  categoryKey,
  categoryUsage,
  findCategoryCollision,
  hasActiveCategory,
  uniqueCategoryId,
} from "@/lib/menu-categories";
import { MENU_ERROR_CODES, menuErrorCode, menuErrorKey, reportMenuError } from "@/lib/menu-errors";
import { toMenuReadModel } from "@/lib/menu-read-model";
import { roleDefaults, type Permission } from "@/lib/permissions";
import { __resetObservabilityForTests, setLogWriter } from "@/lib/observability";
import type { Database } from "@/integrations/supabase/types";

const SRC = path.resolve(__dirname, "..");
const locale = (lang: string) =>
  JSON.parse(fs.readFileSync(path.join(SRC, "locales", lang, "menu.json"), "utf8")) as Record<
    string,
    unknown
  >;
const lookup = (data: Record<string, unknown>, key: string) =>
  key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], data);

describe("menu abilities (UI hints mirroring the RPC rules)", () => {
  const roleCan = (role: "owner" | "manager" | "staff") => (p: Permission) =>
    (roleDefaults(role) as readonly string[]).includes(p);
  const stores: MenuStore[] = [
    { id: "a", lifecycle: "active" },
    { id: "b", lifecycle: "active" },
    { id: "p", lifecycle: "placeholder" },
    { id: "x", lifecycle: "inactive" },
  ];

  it("owner manages categories and products of active stores, every store included", () => {
    const a = menuAbilities({ role: "owner", can: roleCan("owner"), stores });
    expect(a.manageCategories).toBe(true);
    expect(a.anyWrite).toBe(true);
    expect(a.productAccess({ locationIds: [] })).toBe("ok");
    expect(a.productAccess({ locationIds: ["a", "b"] })).toBe("ok");
    expect(a.newProductStores("all")).toEqual([]);
  });

  it("owners too are refused for a product listed in a placeholder or inactive store", () => {
    // save_operational_menu checks can_operate_location for every listed store, owners included.
    const a = menuAbilities({ role: "owner", can: roleCan("owner"), stores });
    expect(a.productAccess({ locationIds: ["a", "p"] })).toBe("inactiveStore");
    expect(a.productAccess({ locationIds: ["x"] })).toBe("inactiveStore");
  });

  it("manager: only products sold exclusively in their active stores, never categories", () => {
    const mine: MenuStore[] = [
      { id: "a", lifecycle: "active" },
      { id: "p", lifecycle: "placeholder" },
    ];
    const a = menuAbilities({ role: "manager", can: roleCan("manager"), stores: mine });
    expect(a.manageCategories).toBe(false);
    expect([a.createProducts, a.editProducts, a.archiveProducts]).toEqual([true, true, true]);
    expect(a.productAccess({ locationIds: ["a"] })).toBe("ok");
    // Sold in every store (no list): owner-only in the database.
    expect(a.productAccess({ locationIds: [] })).toBe("allStores");
    // Also sold in a store the manager cannot see (the read drops it; the count says so).
    expect(a.productAccess({ locationIds: ["a"], otherStoreCount: 1 })).toBe("otherStores");
    expect(a.productAccess({ locationIds: ["a", "b"] })).toBe("otherStores");
    expect(a.productAccess({ locationIds: ["p"] })).toBe("inactiveStore");
    // New products are sold in active stores only.
    expect(a.newProductStores("all")).toEqual(["a"]);
    expect(a.newProductStores("a")).toEqual(["a"]);
    expect(a.newProductStores("p")).toBeNull();
  });

  it("a manager without any active store cannot create products", () => {
    const a = menuAbilities({
      role: "manager",
      can: roleCan("manager"),
      stores: [{ id: "p", lifecycle: "placeholder" }],
    });
    expect(a.createProducts).toBe(false);
    expect(a.newProductStores("all")).toBeNull();
  });

  it("staff is read-only (menu.view only)", () => {
    const a = menuAbilities({ role: "staff", can: roleCan("staff"), stores });
    expect(a.anyWrite).toBe(false);
    expect([a.createProducts, a.editProducts, a.archiveProducts]).toEqual([false, false, false]);
    expect(a.manageCategories).toBe(false);
  });

  it("follows the member's actual permissions, not the role name", () => {
    const a = menuAbilities({ role: "manager", can: (p) => p === "menu.edit", stores });
    expect([a.createProducts, a.editProducts, a.archiveProducts]).toEqual([false, true, false]);
    expect(a.anyWrite).toBe(true);
  });
});

describe("menu categories", () => {
  it("derives a stable id from the name", () => {
    expect(categoryIdFromName("Smash Burgers", () => "x")).toBe("smash-burgers");
    expect(categoryIdFromName("  Acompanhamentos & Porções ", () => "x")).toBe(
      "acompanhamentos-porcoes",
    );
    expect(categoryIdFromName("!!!", () => "fallback")).toBe("fallback");
  });

  it("gives a new category a free id (a renamed category keeps its old id)", () => {
    expect(uniqueCategoryId("drinks", ["burgers"])).toBe("drinks");
    expect(uniqueCategoryId("drinks", ["drinks"])).toBe("drinks-2");
    expect(uniqueCategoryId("drinks", ["drinks", "drinks-2"])).toBe("drinks-3");
  });

  const active = [{ id: "burgers", name: "Burgers" }];
  const archived = [{ id: "drinks", name: "Drinks", productCount: 2 }];

  it("reports a name already used, ignoring case, accents, spacing and punctuation", () => {
    expect(findCategoryCollision(" BURGERS ", active, archived).kind).toBe("active");
    expect(findCategoryCollision("Burgers.", active, archived).kind).toBe("active");
    expect(findCategoryCollision("cafes", [{ id: "cafes", name: "Cafés" }], []).kind).toBe(
      "active",
    );
    expect(
      findCategoryCollision("Bebidas  Quentes", [{ id: "b", name: "Bebidas Quentes" }], []).kind,
    ).toBe("active");
  });

  it("reports a name used by an archived category (reactivate it instead)", () => {
    expect(findCategoryCollision("Drinks", active, archived)).toEqual({
      kind: "archived",
      category: archived[0],
    });
  });

  it("compares names, not ids: the old id of a renamed category does not block its old name", () => {
    expect(findCategoryCollision("Drinks", [{ id: "drinks", name: "Beverages" }], []).kind).toBe(
      "none",
    );
    expect(findCategoryCollision("Sides", active, archived).kind).toBe("none");
    // names without any letter or digit are compared as typed
    expect(categoryKey("!!!")).toBe("");
    expect(findCategoryCollision("!!!", [{ id: "c1", name: "!!!" }], []).kind).toBe("active");
  });

  it("counts products and allows archiving only without active ones", () => {
    const usage = categoryUsage([
      { category: "burgers", active: true },
      { category: "burgers", active: false },
      { category: "sides", active: false },
    ]);
    expect(usage.get("burgers")).toEqual({ total: 2, active: 1 });
    expect(canArchiveCategory(usage.get("burgers"))).toBe(false);
    expect(canArchiveCategory(usage.get("sides"))).toBe(true);
    expect(canArchiveCategory(undefined)).toBe(true);
  });

  it("flags products whose category is archived or missing", () => {
    expect(hasActiveCategory({ category: "burgers", active: true }, active)).toBe(true);
    expect(hasActiveCategory({ category: "", active: false }, active)).toBe(false);
    expect(hasActiveCategory({ category: "drinks", active: false }, active)).toBe(false);
  });
});

describe("menu read model (fetchOperationalMenu)", () => {
  type ProductRow = Database["public"]["Tables"]["menu_products"]["Row"];
  const product = (over: Partial<ProductRow>) =>
    ({
      id: `uuid-${over.client_id ?? "x"}`,
      org_id: "org-uuid",
      client_id: "classic",
      category_id: "cat-burgers",
      name: "Classic",
      description: "",
      price_cents: 1250,
      prep_time_minutes: 8,
      image_url: null,
      notes: null,
      active: true,
      location_ids: [],
      modifier_groups: [],
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
      ...over,
    }) as ProductRow;
  const model = toMenuReadModel({
    orgSlug: "org",
    locations: [{ id: "loc-a", slug: "a" }],
    categories: [{ id: "cat-burgers", client_id: "burgers", name: "Burgers", description: "" }],
    archivedCategories: [
      { id: "cat-desserts", client_id: "desserts", name: "Desserts", description: "" },
      { id: "cat-empty", client_id: "empty", name: "Empty", description: "" },
    ],
    products: [
      product({ client_id: "classic", location_ids: [] }),
      product({ client_id: "fries", location_ids: ["loc-a", "loc-hidden"], notes: "crispy" }),
      product({ client_id: "brownie", category_id: "cat-desserts", active: false }),
    ],
  });

  it("keeps categories active-only and counts the products of archived ones", () => {
    expect(model.categories.map((c) => c.id)).toEqual(["burgers"]);
    expect(model.archivedCategories).toEqual([
      { id: "desserts", name: "Desserts", description: "", productCount: 1 },
      { id: "empty", name: "Empty", description: "", productCount: 0 },
    ]);
  });

  it("maps stores to slugs and counts the stores the caller cannot see", () => {
    const fries = model.items.find((i) => i.id === "fries")!;
    expect(fries.locationIds).toEqual(["a"]);
    expect(fries.otherStoreCount).toBe(1);
    expect(fries.notes).toBe("crispy");
    expect(model.items.find((i) => i.id === "classic")!.otherStoreCount).toBe(0);
  });

  it("a product of an archived category has no category in the read", () => {
    expect(model.items.find((i) => i.id === "brownie")!.category).toBe("");
  });
});

describe("menu errors", () => {
  afterEach(() => __resetObservabilityForTests());

  it("maps every known code to its own message", () => {
    for (const code of MENU_ERROR_CODES)
      expect(menuErrorKey(new Error(code))).toBe(`errors.${code}`);
  });

  it("never exposes technical text: unknown codes, SQL and stack traces get the generic message", () => {
    expect(menuErrorKey(new Error("menu_save_failed"))).toBe("errors.unknown");
    expect(
      menuErrorKey(new Error('duplicate key value violates unique constraint "menu_pkey"')),
    ).toBe("errors.unknown");
    expect(menuErrorKey(new Error("TypeError: Failed to fetch"))).toBe("errors.unknown");
    expect(menuErrorKey(undefined)).toBe("errors.unknown");
    expect(menuErrorCode(new Error("Some message"))).toBeNull();
  });

  it("every message exists in en-US and pt-BR", () => {
    for (const lang of ["en-US", "pt-BR"]) {
      const data = locale(lang);
      for (const code of [...MENU_ERROR_CODES, "unknown"])
        expect(typeof lookup(data, `errors.${code}`), `${lang} errors.${code}`).toBe("string");
    }
  });

  it("uses the requested wording for the four business errors (pt-BR)", () => {
    const pt = locale("pt-BR");
    expect(lookup(pt, "errors.category_in_use")).toBe(
      "Esta categoria possui produtos ativos vinculados. Desative ou mova esses produtos antes de arquivar a categoria.",
    );
    expect(lookup(pt, "errors.category_required")).toBe(
      "Este produto precisa estar vinculado a uma categoria ativa.",
    );
    expect(lookup(pt, "errors.forbidden")).toBe(
      "Você não tem permissão para realizar esta operação.",
    );
    expect(lookup(pt, "errors.permission_denied")).toBe(
      "Seu perfil não permite executar esta ação.",
    );
  });

  it("keeps the original code in the logs", () => {
    const lines: string[] = [];
    const previous = setLogWriter((line) => lines.push(line));
    reportMenuError("category.archive", new Error("category_in_use"));
    reportMenuError("product.save", new Error("boom"));
    setLogWriter(previous);
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records[0]).toMatchObject({
      level: "warn",
      event: "menu.action_refused",
      data: { action: "category.archive", code: "category_in_use" },
    });
    expect(records[1]).toMatchObject({ level: "error", event: "menu.action_failed" });
    expect((records[1]!["error"] as { message: string }).message).toBe("boom");
  });
});

describe("menu screen translation keys passed indirectly", () => {
  it("toast, validation and error keys used by the Menu screen exist in both languages", () => {
    const code = fs.readFileSync(path.join(SRC, "components", "menu", "menu-page.tsx"), "utf8");
    const keys = [
      ...new Set([...code.matchAll(/"((?:toast|validation)\.[a-zA-Z]+)"/g)].map((m) => m[1]!)),
    ];
    expect(keys.length).toBeGreaterThan(10);
    for (const lang of ["en-US", "pt-BR"]) {
      const data = locale(lang);
      for (const key of keys) expect(typeof lookup(data, key), `${lang} ${key}`).toBe("string");
    }
  });
});
