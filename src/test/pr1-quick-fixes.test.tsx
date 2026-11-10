import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import i18n from "@/lib/i18n";
import {
  TEMPORARY_DEVICE_KEY_PREFIXES,
  clearTemporaryDeviceData,
  countHeldTicketsOnDevice,
} from "@/lib/session-cleanup";
import { confirmedReceipt } from "@/lib/pos-receipt";
import { OrdersTruncatedNotice } from "@/components/app/states";
import { socialProvidersFromEnv } from "@/lib/auth";
import * as posService from "@/lib/pos-service";

const SRC = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------------------------
// 1. Sign-out removes temporary device data only
// ---------------------------------------------------------------------------------------------
describe("sign-out cleanup of temporary device data", () => {
  const KEEP = {
    "servora.org": "org-uuid",
    "servora.mode": "dark",
    "servora.lang": "pt-BR",
    "servora.inventory.view": "cards",
    "servora.auth.ephemeral": "0",
    "sb-127-auth-token": '{"access_token":"x"}',
    // quarantined legacy stores are never deleted silently (Phase 0 policy)
    "servora.quarantine.servora_inventory_v1": "[]",
    servora_suppliers_org_a: "[]",
    servora_purchase_orders_org_a: "[]",
    "servora.menu.org_a.items": "[]",
  };
  const REMOVE = {
    "servora.pos.suspended.org_a": JSON.stringify([{ id: "h1" }, { id: "h2" }]),
    "servora.pos.suspended.org_b": JSON.stringify([{ id: "h3" }]),
    "servora.quarantine.pos.suspended.org_a": JSON.stringify([{ id: "old" }]),
    "servora.pos.history.org_a": JSON.stringify([{ id: "sim" }]),
    "servora.orders.org_marao": JSON.stringify([{ id: "demo-ticket" }]),
  };

  beforeEach(() => {
    localStorage.clear();
    for (const [k, v] of Object.entries({ ...KEEP, ...REMOVE })) localStorage.setItem(k, v);
  });

  it("removes held tickets and simulated local tickets, nothing else", () => {
    const removed = clearTemporaryDeviceData();
    expect(removed.sort()).toEqual(Object.keys(REMOVE).sort());
    for (const k of Object.keys(REMOVE)) expect(localStorage.getItem(k)).toBeNull();
    for (const [k, v] of Object.entries(KEEP)) expect(localStorage.getItem(k)).toBe(v);
  });

  it("is idempotent and never throws when storage fails", () => {
    clearTemporaryDeviceData();
    expect(clearTemporaryDeviceData()).toEqual([]);
    const broken = {
      length: 1,
      key: () => "servora.pos.suspended.x",
      getItem: () => null,
      removeItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => clearTemporaryDeviceData(broken)).not.toThrow();
    expect(clearTemporaryDeviceData(null)).toEqual([]);
  });

  it("counts held tickets on the device across organizations (malformed counts as one)", () => {
    expect(countHeldTicketsOnDevice()).toBe(3);
    localStorage.setItem("servora.pos.suspended.org_c", "{not json");
    expect(countHeldTicketsOnDevice()).toBe(4);
    clearTemporaryDeviceData();
    expect(countHeldTicketsOnDevice()).toBe(0);
  });

  it("only targets device-only prefixes, never server data or preferences", () => {
    expect([...TEMPORARY_DEVICE_KEY_PREFIXES]).toEqual([
      "servora.pos.suspended.",
      "servora.quarantine.pos.suspended.",
      "servora.pos.history.",
      "servora.orders.",
    ]);
    const code = fs.readFileSync(path.join(SRC, "lib/session-cleanup.ts"), "utf8");
    expect(code).not.toMatch(/supabase|fetch\(|\.rpc\(|operational\.functions/);
  });

  it("is wired to the global sign-out event and to the account menu", () => {
    const root = fs.readFileSync(path.join(SRC, "routes/__root.tsx"), "utf8");
    expect(root).toMatch(/event === "signed_out"[\s\S]{0,200}clearTemporaryDeviceData\(\)/);
    const shell = fs.readFileSync(path.join(SRC, "components/app/app-shell.tsx"), "utf8");
    expect(shell).toMatch(/await auth\.signOut\(\);[\s\S]{0,200}clearTemporaryDeviceData\(\)/);
    expect(shell).toContain("countHeldTicketsOnDevice()");
  });
});

// ---------------------------------------------------------------------------------------------
// 2. The receipt describes what the server recorded
// ---------------------------------------------------------------------------------------------
describe("POS receipt from the server confirmation", () => {
  const paid = { subtotalCents: 1000, taxCents: 89, totalCents: 1089, tenderedCents: 2000 };

  it("uses the server totals over the client estimate", () => {
    const r = confirmedReceipt(paid, {
      subtotalCents: 1000,
      taxCents: 88,
      totalCents: 1088,
      isSimulation: false,
    });
    expect(r).toMatchObject({ subtotalCents: 1000, taxCents: 88, totalCents: 1088 });
    expect(r.tenderedCents).toBe(2000);
  });

  it("labels a simulation only when the stored order is a simulation", () => {
    expect(confirmedReceipt(paid, { isSimulation: false }).isSimulation).toBe(false);
    expect(confirmedReceipt(paid, { isSimulation: true }).isSimulation).toBe(true);
    // A demo organization whose sale was stored as real gets a normal receipt.
    expect(confirmedReceipt(paid, {}).isSimulation).toBe(false);
  });

  it("keeps the client values only when the server sent none", () => {
    expect(confirmedReceipt(paid, {})).toMatchObject({ taxCents: 89, totalCents: 1089 });
  });

  it("the POS no longer derives the receipt label from the organization type", () => {
    const pos = fs.readFileSync(path.join(SRC, "routes/_authenticated/_app/pos.tsx"), "utf8");
    expect(pos).not.toMatch(/isSimulation:\s*org\.fictional/);
    expect(pos).toContain("confirmedReceipt(paid, persistRes)");
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Finance and Reports load the full history (up to the cap) and say when it is cut
// ---------------------------------------------------------------------------------------------
describe("order history in Finance and Reports", () => {
  it("Finance uses the paged loader instead of a single page of 200", () => {
    const finance = fs.readFileSync(
      path.join(SRC, "routes/_authenticated/_app/finance.tsx"),
      "utf8",
    );
    expect(finance).toContain('fetchAllOrders(org.id, "all")');
    expect(finance).not.toMatch(/limit:\s*200/);
    expect(finance).toContain("<OrdersTruncatedNotice");
    const reports = fs.readFileSync(
      path.join(SRC, "routes/_authenticated/_app/reports.tsx"),
      "utf8",
    );
    expect(reports).toContain("<OrdersTruncatedNotice");
  });

  it("the notice appears only when older orders are missing, in both languages", async () => {
    await i18n.changeLanguage("en-US");
    const { container, rerender } = render(
      <OrdersTruncatedNotice shown={450} total={450} truncated={false} />,
    );
    expect(container).toBeEmptyDOMElement();
    // a sale arriving mid-read makes total exceed what was read, but nothing was cut: no notice
    rerender(<OrdersTruncatedNotice shown={458} total={459} truncated={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OrdersTruncatedNotice shown={5000} total={9000} truncated />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "These figures include the 5000 most recent orders out of 9000.",
    );
    await i18n.changeLanguage("pt-BR");
    rerender(<OrdersTruncatedNotice shown={5000} total={9000} truncated />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Estes números incluem os 5000 pedidos mais recentes de um total de 9000.",
    );
    await i18n.changeLanguage("en-US");
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Social sign-in is opt-in per deployment
// ---------------------------------------------------------------------------------------------
describe("social sign-in providers from configuration", () => {
  const enabled = (raw: string | undefined) =>
    socialProvidersFromEnv(raw)
      .filter((p) => p.enabled)
      .map((p) => p.id);

  it("shows no social button unless configured", () => {
    expect(enabled(undefined)).toEqual([]);
    expect(enabled("")).toEqual([]);
    expect(enabled(" , ")).toEqual([]);
  });

  it("enables only listed, known providers (case and spaces ignored)", () => {
    expect(enabled("google")).toEqual(["google"]);
    expect(enabled(" Google , MICROSOFT ")).toEqual(["google", "microsoft"]);
    expect(enabled("github,google")).toEqual(["google"]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Dead local-data code is gone
// ---------------------------------------------------------------------------------------------
describe("removed dead code", () => {
  it("the POS service no longer exposes the local simulated-sales history", () => {
    for (const name of [
      "listPosHistory",
      "recordCompletedSale",
      "finalizeSale",
      "finalizeAndPersistSale",
      "submitPosSaleToBackend",
    ])
      expect(posService).not.toHaveProperty(name);
  });

  it("unused demo modules are removed", () => {
    expect(fs.existsSync(path.join(SRC, "lib/support-service.ts"))).toBe(false);
    expect(fs.existsSync(path.join(SRC, "lib/orders-backend.ts"))).toBe(false);
  });
});
