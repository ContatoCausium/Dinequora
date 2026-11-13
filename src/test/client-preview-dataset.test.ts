import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACCOUNTS,
  buildDataset,
  CATEGORIES,
  convertQuantity,
  DATASET_PROFILES,
  EMAIL_DOMAIN,
  LEDGER_READ_CAP,
  localYmd,
  ORG,
  PRODUCTS,
  STOCK,
  STORES,
  SUPPLIERS,
  zonedInstant,
} from "../../scripts/preview/dataset.mjs";
import {
  assertResolvedTarget,
  resolvePreviewTarget,
} from "../../scripts/preview/client-preview-target.mjs";
import { assertCredsFileOutsideRepo } from "../../scripts/preview/seed-core.mjs";
import { menuItemSchema, recipePayloadSchema, saleInputSchema } from "@/lib/operational-contracts";
import { EXPENSE_CATEGORIES } from "@/lib/finance-service";
import { isRecipeUnit } from "@/lib/units";

/**
 * Client-preview dataset (scripts/preview/dataset.mjs): deterministic, fictional, valid against the
 * same contracts the app applies, and planned so that — executed in business-time order with the
 * server's consumption rule — no sale finds insufficient stock. Plus the destination resolver of the
 * seed/reset/verify scripts. Pure: no network, no database.
 */
const NOW = Date.parse("2026-11-13T19:30:00Z");
const plan = buildDataset({ now: NOW });
const stockBySku = Object.fromEntries(STOCK.map((s) => [s.sku, s]));
const productById = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

afterEach(() => vi.unstubAllGlobals());

describe("determinism and period", () => {
  it("the same now and seed give the same plan", () => {
    const again = buildDataset({ now: NOW });
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(plan.events));
    expect(again.summary).toEqual(plan.summary);
  });
  it("another seed gives another plan", () => {
    expect(JSON.stringify(buildDataset({ now: NOW, seed: 7 }).events)).not.toBe(
      JSON.stringify(plan.events),
    );
  });
  it("covers the profile's days up to today in the stores' time zone", () => {
    expect(plan.summary.profile).toBe("ledger-safe");
    expect(plan.todayYmd).toBe("2026-11-13");
    expect(plan.summary.days).toBe(DATASET_PROFILES["ledger-safe"].days);
    for (const s of plan.stores) {
      const days = new Set(s.sales.map((x) => localYmd(x.at)));
      expect(days.size, s.key).toBeGreaterThanOrEqual(plan.summary.days);
    }
  });
  it("everything happens in the past and steps are in order", () => {
    for (const e of plan.events) {
      expect(e.at).toBeLessThanOrEqual(NOW);
      if (e.kind !== "sale") continue;
      let t = e.sale.at;
      for (const st of e.sale.steps) {
        expect(st.at).toBeGreaterThan(t);
        expect(st.at).toBeLessThanOrEqual(NOW);
        t = st.at;
      }
    }
  });
  it("orders happen inside each store's opening hours", () => {
    for (const s of plan.stores)
      for (const sale of s.sales) {
        const [h, m] = new Intl.DateTimeFormat("en-GB", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .format(new Date(sale.at))
          .split(":")
          .map(Number);
        const minute = h! * 60 + m!;
        expect(minute).toBeGreaterThanOrEqual(s.open[0] * 60 + s.open[1]);
        expect(minute).toBeLessThan(s.close[0] * 60 + s.close[1]);
      }
  });
  it("the live kitchen board has open tickets in every store, minutes old", () => {
    for (const s of plan.stores) {
      expect(s.openTickets.length).toBeGreaterThanOrEqual(3);
      for (const t of s.openTickets) {
        expect(["confirmed", "in_prep", "ready"]).toContain(t.liveStatus);
        expect(NOW - t.at).toBeLessThan(20 * 60_000);
      }
    }
  });
  it("time-zone helper handles daylight-saving changes", () => {
    expect(new Date(zonedInstant("2026-07-01", 12, 0)).toISOString()).toBe(
      "2026-07-01T16:00:00.000Z",
    ); // EDT
    expect(new Date(zonedInstant("2026-12-01", 12, 0)).toISOString()).toBe(
      "2026-12-01T17:00:00.000Z",
    ); // EST
    expect(new Date(zonedInstant("2026-11-01", 3, 0)).toISOString()).toBe(
      "2026-11-01T08:00:00.000Z",
    ); // after fall-back
  });
});

describe("the ledger fits the app's single read", () => {
  it("ledger-safe stays under the PostgREST row cap with room for live demo sales", () => {
    expect(plan.summary.ledgerEntries).toBeLessThan(LEDGER_READ_CAP);
    expect(Math.floor((LEDGER_READ_CAP - plan.summary.ledgerEntries) / 2)).toBeGreaterThanOrEqual(
      50,
    );
  });
  it("full is the realistic volume and does not fit (needs a paged ledger read)", () => {
    expect(buildDataset({ now: NOW, profile: "full" }).summary.ledgerEntries).toBeGreaterThan(
      LEDGER_READ_CAP,
    );
  });
  it("unknown profiles are refused", () => {
    expect(() => buildDataset({ now: NOW, profile: "huge" as "full" })).toThrow(
      /unknown dataset profile/,
    );
  });
});

describe("valid against the app contracts", () => {
  const orgSlug = "org_demo";
  it("every product is a valid menu item with valid modifiers", () => {
    for (const p of PRODUCTS)
      menuItemSchema.parse({
        id: p.id,
        orgId: orgSlug,
        name: p.name,
        description: p.description,
        category: p.category,
        priceCents: p.priceCents,
        prepTimeMinutes: p.prep,
        imageUrl: "",
        notes: "",
        active: true,
        locationIds: ["loc"],
        modifierGroups: p.modifiers,
        createdAt: new Date(NOW).toISOString(),
      });
    expect(new Set(PRODUCTS.map((p) => p.category))).toEqual(new Set(CATEGORIES.map((c) => c.id)));
  });
  it("every recipe is a valid recipe payload with units the server converts to the stock unit", () => {
    for (const p of PRODUCTS) {
      recipePayloadSchema.parse({
        productId: p.id,
        servings: 1,
        yieldQuantity: 1,
        ingredients: p.recipe.map(([sku, quantity, unit, waste]) => ({
          inventoryItemId: sku,
          quantity,
          unit,
          wastePercentage: waste,
        })),
      });
      for (const [sku, q, unit] of p.recipe) {
        expect(isRecipeUnit(unit), `${p.id} ${unit}`).toBe(true);
        expect(() => convertQuantity(q, unit, stockBySku[sku]!.unit)).not.toThrow();
      }
    }
    // the gal unit fixed by PR #24 is exercised by real recipes
    expect(PRODUCTS.some((p) => p.recipe.some(([sku]) => stockBySku[sku]!.unit === "gal"))).toBe(
      true,
    );
  });
  it("every planned sale is a valid POS sale input of its store", () => {
    for (const s of plan.stores)
      for (const sale of [...s.sales, ...s.openTickets]) {
        saleInputSchema.parse({
          orgId: orgSlug,
          locationId: s.key,
          clientOrderId: sale.clientOrderId,
          orderType: sale.type,
          customerName: sale.customerName,
          discountCents: sale.discountCents,
          taxRatePpm: s.taxRatePpm,
          paymentMethod: sale.payment,
          items: sale.items,
        });
        for (const it of sale.items)
          expect(s.products, `${s.key} sells ${it.productId}`).toContain(it.productId);
        if (s.key === "airport") expect(sale.type).not.toBe("delivery");
      }
  });
  it("stock items use the server's stock units and the app's inventory categories", () => {
    const units = ["oz", "lb", "gal", "kg", "units", "pack"];
    const categories = [
      "meat",
      "produce",
      "dairy",
      "bakery",
      "dry_goods",
      "beverages",
      "packaging",
    ];
    for (const s of STOCK) {
      expect(units).toContain(s.unit);
      expect(categories).toContain(s.category);
      expect(s.costCents).toBeGreaterThan(0);
    }
    expect(new Set(STOCK.map((s) => s.sku)).size).toBe(STOCK.length);
  });
  it("expenses use the app's categories, recurrences and statuses", () => {
    for (const e of plan.expenses) {
      expect(EXPENSE_CATEGORIES).toContain(e.payload["category"]);
      expect(["fixed", "variable", "recurring"]).toContain(e.payload["recurrence"]);
      expect(["pending", "paid", "overdue"]).toContain(e.payload["status"]);
      expect(e.payload["isSimulation"]).toBe(false);
      if (e.payload["status"] === "paid") expect(e.payload["paidAt"]).toBeTruthy();
    }
    expect(plan.expenses.some((e) => e.payload["status"] === "overdue")).toBe(true);
  });
});

describe("stock is consistent with the server's consumption rule", () => {
  it("executed in business-time order, no sale ever finds insufficient stock", () => {
    for (const s of plan.stores) {
      const sp = plan.stockPlan[s.key]!;
      const q: Record<string, number> = { ...sp.opening };
      for (const e of plan.events.filter((x) => x.store === s.key)) {
        if (e.kind === "receipt") {
          for (const it of e.receipt.items) q[it.sku]! += it.quantity;
          continue;
        }
        for (const it of e.sale.items)
          for (const [sku, qty, unit, waste] of productById[it.productId]!.recipe) {
            q[sku]! -=
              convertQuantity(qty, unit, stockBySku[sku]!.unit) * (1 + waste / 100) * it.quantity;
            expect(q[sku]!, `${s.key} ${sku} after ${e.sale.clientOrderId}`).toBeGreaterThanOrEqual(
              -1e-9,
            );
          }
      }
      for (const sku of Object.keys(q)) expect(q[sku]!).toBeCloseTo(sp.expectedFinal[sku]!, 6);
    }
  });
  it("receipts are weekly, before the store opens, ordered two days earlier", () => {
    for (const s of plan.stores)
      for (const r of plan.stockPlan[s.key]!.receipts) {
        expect(r.receivedAt - r.orderedAt).toBeGreaterThan(36 * 3_600_000);
        expect(r.items.length).toBeGreaterThan(0);
      }
  });
  it("alert items show as low yet keep 30 servings, so a live demo can still sell them", () => {
    for (const s of plan.stores) {
      const sp = plan.stockPlan[s.key]!;
      expect(sp.lowAtEnd.length).toBeGreaterThan(0);
      for (const sku of sp.lowAtEnd) {
        const keep = sp.alertKeep[sku]!;
        const largest = Math.max(
          ...PRODUCTS.flatMap((p) =>
            p.recipe
              .filter(([k]) => k === sku)
              .map(
                ([k, q, unit, waste]) =>
                  convertQuantity(q, unit, stockBySku[k]!.unit) * (1 + waste / 100),
              ),
          ),
        );
        expect(keep / largest, `${s.key} ${sku} servings`).toBeGreaterThanOrEqual(30 - 1e-6);
        expect(keep, `${s.key} ${sku} below its minimum`).toBeLessThan(sp.minQuantity[sku]!);
        // the plan holds at least that much before the closing-check loss
        expect(sp.expectedFinal[sku]!, `${s.key} ${sku}`).toBeGreaterThanOrEqual(keep - 1e-6);
      }
    }
  });
});

describe("fictional by construction", () => {
  it("accounts use the reserved .test domain and stores the fictional 555-01xx range", () => {
    expect(EMAIL_DOMAIN.endsWith(".test")).toBe(true);
    for (const a of ACCOUNTS) expect(a.email.endsWith(`@${EMAIL_DOMAIN}`)).toBe(true);
    for (const s of STORES) {
      expect(s.phone).toMatch(/^\+1 555-01\d\d$/);
      expect(s.address).toMatch(/\(fictional\)$/);
    }
    for (const sale of plan.events.flatMap((e) => (e.kind === "sale" ? [e.sale] : [])))
      if (sale.customerPhone) expect(sale.customerPhone).toMatch(/^\+1 555-01\d\d$/);
  });
  it("suppliers and the organization are clearly demo", () => {
    for (const s of SUPPLIERS) expect(s.name.startsWith("Demo ")).toBe(true);
    expect(ORG.name).toBe("Dinequora Demo Restaurant");
    expect(ORG.companyAddress).toMatch(/fictional/);
  });
  it("roles: one owner, one store manager, one kitchen account", () => {
    expect(ACCOUNTS.map((a) => [a.role, a.profile ?? null, a.stores ?? []])).toEqual([
      ["owner", null, []],
      ["manager", null, ["westside"]],
      ["staff", "kitchen", ["downtown"]],
    ]);
  });
});

describe("destination resolver", () => {
  it("refuses a missing mode, a missing publishable key and unknown operations, before any request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      resolvePreviewTarget(
        { PREVIEW_API_URL: "http://127.0.0.1:64731", PREVIEW_PUBLISHABLE_KEY: "x".repeat(30) },
        "seed:client-preview",
      ),
    ).rejects.toThrow(/PREVIEW_TARGET/);
    await expect(
      resolvePreviewTarget(
        { PREVIEW_TARGET: "local", PREVIEW_API_URL: "http://127.0.0.1:64731" },
        "seed:client-preview",
      ),
    ).rejects.toThrow(/publishable/);
    await expect(
      resolvePreviewTarget({ PREVIEW_TARGET: "local" }, "seed:qa-tenant"),
    ).rejects.toThrow(/unknown operation/);
    await expect(
      resolvePreviewTarget({ PREVIEW_TARGET: "production" }, "seed:client-preview"),
    ).rejects.toThrow(/PREVIEW_TARGET/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("local mode uses the target guard (loopback + disposable marker), hosted mode the preview guard", async () => {
    const env = { PREVIEW_SERVICE_KEY: "svc", PREVIEW_PUBLISHABLE_KEY: "p".repeat(30) };
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      resolvePreviewTarget(
        {
          ...env,
          PREVIEW_TARGET: "local",
          PREVIEW_API_URL: "https://abcdefghij0123456789.supabase.co",
        },
        "seed:client-preview",
      ),
    ).rejects.toThrow(/remote API host/);
    await expect(
      resolvePreviewTarget(
        { ...env, PREVIEW_TARGET: "hosted", PREVIEW_API_URL: "http://127.0.0.1:64731" },
        "seed:client-preview",
      ),
    ).rejects.toThrow(/local or private host/);
    const attest = vi.fn(
      async () => new Response(JSON.stringify({ cluster_hash: "0".repeat(64) }), { status: 200 }),
    );
    vi.stubGlobal("fetch", attest);
    const t = await resolvePreviewTarget(
      { ...env, PREVIEW_TARGET: "local", PREVIEW_API_URL: "http://127.0.0.1:64731/" },
      "seed:client-preview",
    );
    expect(t.where).toMatch(/^local disposable stack/);
    expect(t.apiUrl).toBe("http://127.0.0.1:64731");
    expect(String((attest.mock.calls[0] as unknown[])[0])).toBe(
      "http://127.0.0.1:64731/rest/v1/rpc/attest",
    );
    expect(() => assertResolvedTarget(t)).not.toThrow();
  });
  it("a hand-built destination is never accepted by the writer", () => {
    expect(() =>
      assertResolvedTarget({
        mode: "local",
        operation: "seed:client-preview",
        apiUrl: "http://127.0.0.1:55321",
        serviceKey: "x",
        publishableKey: "y",
      }),
    ).toThrow(/not a destination checked/);
    expect(() => assertResolvedTarget(null)).toThrow();
  });
  it("the credentials file must live outside the repository", () => {
    expect(() => assertCredsFileOutsideRepo(undefined)).toThrow(/required/);
    expect(() => assertCredsFileOutsideRepo("creds.json")).toThrow(/outside the repository/);
    expect(() =>
      assertCredsFileOutsideRepo(path.resolve(__dirname, "../../scripts/creds.json")),
    ).toThrow(/outside/);
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dq-cp-")), "creds.json");
    expect(assertCredsFileOutsideRepo(outside)).toBe(path.resolve(outside));
  });
});
