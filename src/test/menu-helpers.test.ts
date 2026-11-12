import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { menuAbilities } from "@/lib/menu-abilities";
import {
  canArchiveCategory,
  categoryIdFromName,
  categoryUsage,
  findCategoryCollision,
  hasActiveCategory,
} from "@/lib/menu-categories";
import { MENU_ERROR_CODES, menuErrorCode, menuErrorKey, reportMenuError } from "@/lib/menu-errors";
import { roleDefaults, type Permission } from "@/lib/permissions";
import { __resetObservabilityForTests, setLogWriter } from "@/lib/observability";

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

  it("owner manages categories and every product", () => {
    const a = menuAbilities({ role: "owner", can: roleCan("owner"), storeIds: ["a", "b"] });
    expect(a.manageCategories).toBe(true);
    expect(a.anyWrite).toBe(true);
    expect(a.canTouchProduct({ locationIds: [] })).toBe(true);
    expect(a.canTouchProduct({ locationIds: ["z"] })).toBe(true);
  });

  it("manager edits products of their stores only and never categories", () => {
    const a = menuAbilities({ role: "manager", can: roleCan("manager"), storeIds: ["a"] });
    expect(a.manageCategories).toBe(false);
    expect([a.createProducts, a.editProducts, a.archiveProducts]).toEqual([true, true, true]);
    expect(a.canTouchProduct({ locationIds: ["a"] })).toBe(true);
    expect(a.canTouchProduct({ locationIds: ["a", "b"] })).toBe(false);
    // Sold in every store (no list): owner-only in the database.
    expect(a.canTouchProduct({ locationIds: [] })).toBe(false);
  });

  it("staff is read-only (menu.view only)", () => {
    const a = menuAbilities({ role: "staff", can: roleCan("staff"), storeIds: ["a"] });
    expect(a.anyWrite).toBe(false);
    expect([a.createProducts, a.editProducts, a.archiveProducts]).toEqual([false, false, false]);
    expect(a.manageCategories).toBe(false);
  });

  it("follows the member's actual permissions, not the role name", () => {
    const a = menuAbilities({ role: "manager", can: (p) => p === "menu.edit", storeIds: ["a"] });
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

  const active = [{ id: "burgers", name: "Burgers" }];
  const archived = [{ id: "drinks", name: "Drinks", productCount: 2 }];

  it("reports a new category that would overwrite an active one", () => {
    expect(findCategoryCollision("burgers", "burgers", active, archived).kind).toBe("active");
    expect(findCategoryCollision(" BURGERS ", "other-id", active, archived).kind).toBe("active");
  });

  it("reports a new category that would silently reactivate an archived one", () => {
    const c = findCategoryCollision("Drinks", "drinks", active, archived);
    expect(c).toEqual({ kind: "archived", category: archived[0] });
  });

  it("compares only names for a rename", () => {
    expect(findCategoryCollision("Burgers", null, [], archived).kind).toBe("none");
    expect(findCategoryCollision("drinks", null, [], archived).kind).toBe("archived");
    expect(findCategoryCollision("Sides", "sides", active, archived).kind).toBe("none");
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
