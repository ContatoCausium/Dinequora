// Wave 0 — POS sale outbox in the register: lost responses, timeouts, reloads, repeated attempts,
// two tabs and delayed responses. The sale persistence and the lookup are mocked here (the real
// database guarantees are in src/test/integration/pos-idempotency.db.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { roleDefaults, type Permission } from "@/lib/permissions";
import type { Location } from "@/lib/tenants";
import { classifyAttempt, listPendingSales, pendingStorageKey } from "@/lib/pos-outbox";

const api = vi.hoisted(() => ({
  fetchOperationalMenu: vi.fn(),
  findSaleByClientOrderId: vi.fn(),
}));
const persistence = vi.hoisted(() => ({
  persistFinalizedPOSSaleAtomic: vi.fn(),
  cancelOrderWithReversal: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const workspace = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/operational.functions", () => api);
vi.mock("@/lib/orders-persistence-service", () => persistence);
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/app/workspace-context", () => ({ useWorkspace: () => workspace.current }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { POSPage } from "@/components/pages/pos-page";

const store: Location = {
  id: "downtown",
  dbId: "db-downtown",
  name: "Downtown",
  status: "verified",
  lifecycle: "active",
  timezone: "America/New_York",
  taxRatePpm: 62500,
  demoScale: 1,
} as Location;

function setWorkspace() {
  const perms = new Set<Permission>(roleDefaults("staff"));
  workspace.current = {
    role: "staff",
    can: (p: Permission) => perms.has(p),
    canAny: (ps: Permission[]) => ps.some((p) => perms.has(p)),
    user: { id: "user-1", fullName: "Pat Cashier", email: "pat@example.test" },
    org: {
      id: "org-1",
      name: "Test Kitchen",
      initials: "TK",
      fictional: false,
      locations: [store],
    },
    locationId: "downtown",
    setLocationId: vi.fn(),
    refresh: vi.fn(),
  };
}

const MENU = {
  categories: [{ id: "mains", name: "Mains" }],
  archivedCategories: [],
  items: [
    {
      id: "burger",
      orgId: "org-1",
      name: "Classic Burger",
      description: "",
      category: "mains",
      priceCents: 1000,
      prepTimeMinutes: 5,
      active: true,
      locationIds: [],
      modifierGroups: [],
      createdAt: "2026-11-01T00:00:00.000Z",
    },
  ],
};
const confirmed = {
  success: true,
  orderId: "order-1",
  orderNumber: "#A1",
  subtotalCents: 1000,
  taxCents: 63,
  totalCents: 1063,
  isSimulation: false,
  readback: true,
};
const found = {
  status: "found",
  orderId: "order-1",
  orderNumber: "#A1",
  subtotalCents: 1000,
  taxCents: 63,
  totalCents: 1063,
  isSimulation: false,
  orderStatus: "delivered",
  sameStore: true,
  paid: true,
  paymentMethod: "cash",
};

const addBurger = async () =>
  fireEvent.click(await screen.findByRole("button", { name: /^Add Classic Burger,/ }));
async function charge() {
  fireEvent.click(screen.getByRole("button", { name: /^Charge / }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm payment" }));
}
const keysSent = () =>
  persistence.persistFinalizedPOSSaleAtomic.mock.calls.map((c) => c[1] as string);
const pendingDialog = () => screen.findByRole("dialog", { name: /Sale not confirmed yet/ });
const networkError = () => new TypeError("Failed to fetch");

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  localStorage.clear();
  setWorkspace();
  api.fetchOperationalMenu.mockReset().mockResolvedValue(MENU);
  api.findSaleByClientOrderId.mockReset().mockResolvedValue({ status: "not_found" });
  persistence.persistFinalizedPOSSaleAtomic.mockReset().mockResolvedValue(confirmed);
  for (const f of [toast.success, toast.error, toast.info]) f.mockReset();
});
afterEach(() => cleanup());

describe("classifyAttempt", () => {
  it("only a confirmed id is a recorded sale; failures are refusals or unknown", () => {
    expect(classifyAttempt({ success: true, orderId: "o", readback: false }, null)).toEqual({
      kind: "recorded",
      orderId: "o",
      details: false,
    });
    expect(classifyAttempt(null, networkError())).toMatchObject({
      kind: "unknown",
      reason: "network",
    });
    expect(classifyAttempt(null, new DOMException("t", "TimeoutError"))).toMatchObject({
      kind: "unknown",
      reason: "timeout",
    });
    expect(classifyAttempt(null, new Error("insufficient_stock"))).toEqual({
      kind: "refused",
      code: "insufficient_stock",
    });
    expect(classifyAttempt(null, new Error("forbidden"))).toMatchObject({
      kind: "unknown",
      reason: "access",
    });
    expect(classifyAttempt(null, new Error("idempotency_conflict"))).toEqual({ kind: "conflict" });
    expect(classifyAttempt(null, new Error("HTTP 502 Bad Gateway"))).toMatchObject({
      kind: "unknown",
      reason: "server",
    });
  });
});

describe("POS sale outbox", () => {
  it("sends with a random UUID key persisted BEFORE the request", async () => {
    let storedDuringRequest: unknown[] = [];
    persistence.persistFinalizedPOSSaleAtomic.mockImplementation(async () => {
      storedDuringRequest = listPendingSales("org-1");
      return confirmed;
    });
    render(<POSPage />);
    await addBurger();
    await charge();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sale recorded · Order #A1"));
    const [key] = keysSent();
    expect(key).toMatch(
      /^pos-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(storedDuringRequest).toHaveLength(1);
    expect(storedDuringRequest[0]).toMatchObject({ key, state: "sending", attempts: 1 });
    // resolved: the outbox is empty again
    expect(listPendingSales("org-1")).toEqual([]);
    // the signal enforces the attempt timeout
    expect(persistence.persistFinalizedPOSSaleAtomic.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
  });

  it("lost response: the sale stays pending, is never treated as failed, and the ticket is locked", async () => {
    persistence.persistFinalizedPOSSaleAtomic.mockRejectedValueOnce(networkError());
    render(<POSPage />);
    await addBurger();
    await charge();
    const dialog = await pendingDialog();
    expect(dialog).toHaveTextContent("Don't take payment again");
    // checked automatically by key; "not found" keeps it pending
    await waitFor(() => expect(api.findSaleByClientOrderId).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/No recorded sale was found with this code yet/),
    ).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(listPendingSales("org-1")).toHaveLength(1);
    expect(listPendingSales("org-1")[0]!.state).toBe("unknown");
    // the dialog cannot be dismissed with Escape
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: /Sale not confirmed yet/ })).toBeInTheDocument();
  });

  it("repeated attempts always reuse the SAME key, then the confirmation clears the pending sale", async () => {
    persistence.persistFinalizedPOSSaleAtomic
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(confirmed);
    render(<POSPage />);
    await addBurger();
    await charge();
    await pendingDialog();
    await waitFor(() => expect(api.findSaleByClientOrderId).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Send again safely" }));
    await waitFor(() => expect(api.findSaleByClientOrderId).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send again safely" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send again safely" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sale recorded · Order #A1"));
    const keys = keysSent();
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    // identical payload on every attempt
    const payloads = persistence.persistFinalizedPOSSaleAtomic.mock.calls.map((c) =>
      JSON.stringify((c[0] as { cart: unknown }).cart),
    );
    expect(new Set(payloads).size).toBe(1);
    expect(listPendingSales("org-1")).toEqual([]);
    expect(screen.queryByRole("dialog", { name: /Sale not confirmed yet/ })).toBeNull();
  });

  it("a failed check never means 'not recorded': the sale stays pending", async () => {
    persistence.persistFinalizedPOSSaleAtomic.mockRejectedValueOnce(networkError());
    api.findSaleByClientOrderId.mockRejectedValue(networkError());
    render(<POSPage />);
    await addBurger();
    await charge();
    await pendingDialog();
    expect(await screen.findByText(/couldn't reach Dinequora to check/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(api.findSaleByClientOrderId).toHaveBeenCalledTimes(2));
    expect(listPendingSales("org-1")).toHaveLength(1);
    expect(persistence.persistFinalizedPOSSaleAtomic).toHaveBeenCalledTimes(1);
  });

  it("reload: a pending sale comes back and is verified by its key; found = receipt, no resend", async () => {
    persistence.persistFinalizedPOSSaleAtomic.mockRejectedValueOnce(networkError());
    const first = render(<POSPage />);
    await addBurger();
    await charge();
    await pendingDialog();
    const key = keysSent()[0]!;
    first.unmount(); // the tab is reloaded / closed
    // the original request was in fact recorded (delayed): the lookup now finds it
    api.findSaleByClientOrderId.mockReset().mockResolvedValue(found);
    render(<POSPage />);
    await waitFor(() =>
      expect(api.findSaleByClientOrderId).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orgId: "org-1", locationId: "downtown", clientOrderId: key },
        }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sale recorded · Order #A1"));
    expect(persistence.persistFinalizedPOSSaleAtomic).toHaveBeenCalledTimes(1);
    expect(listPendingSales("org-1")).toEqual([]);
  });

  it("delayed response: the late confirmation of the original and the resend are the same order", async () => {
    let releaseFirst: (v: unknown) => void = () => undefined;
    persistence.persistFinalizedPOSSaleAtomic
      .mockImplementationOnce(() => Promise.reject(new DOMException("timed out", "TimeoutError")))
      // the resend: the database returns the order the original already recorded
      .mockImplementationOnce(() => new Promise((r) => (releaseFirst = r)));
    render(<POSPage />);
    await addBurger();
    await charge();
    await pendingDialog();
    await waitFor(() => expect(api.findSaleByClientOrderId).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Send again safely" }));
    expect(screen.getByRole("button", { name: "Check again" })).toBeDisabled();
    await act(async () => releaseFirst(confirmed));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(new Set(keysSent()).size).toBe(1);
  });

  it("two tabs: when the other tab resolves the sale, this one unlocks without recording anything", async () => {
    persistence.persistFinalizedPOSSaleAtomic.mockRejectedValueOnce(networkError());
    render(<POSPage />);
    await addBurger();
    await charge();
    await pendingDialog();
    await waitFor(() => expect(api.findSaleByClientOrderId).toHaveBeenCalledTimes(1));
    // the other tab confirmed it and cleared the shared outbox
    api.findSaleByClientOrderId.mockResolvedValue(found);
    localStorage.removeItem(pendingStorageKey("org-1"));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: pendingStorageKey("org-1") }));
    });
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("This sale was resolved in another tab."),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Sale not confirmed yet/ })).toBeNull(),
    );
    expect(persistence.persistFinalizedPOSSaleAtomic).toHaveBeenCalledTimes(1);
  });

  it("insufficient stock: definitive, nothing pending, readable message pointing to Inventory", async () => {
    persistence.persistFinalizedPOSSaleAtomic.mockRejectedValueOnce(
      new Error("insufficient_stock"),
    );
    render(<POSPage />);
    await addBurger();
    await charge();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [title, opts] = toast.error.mock.calls[0]!;
    expect(title).toBe("The sale was NOT confirmed");
    expect(opts.description).toMatch(/Not enough stock to sell this ticket/);
    expect(opts.description).toMatch(/Inventory/);
    expect(opts.action.label).toBe("Open Inventory");
    expect(listPendingSales("org-1")).toEqual([]);
    // the ticket is kept, with its key: the next attempt reuses it
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await charge();
    await waitFor(() => expect(keysSent()).toHaveLength(2));
    expect(new Set(keysSent()).size).toBe(1);
  });

  it("a browser that cannot keep the outbox never sends the sale", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    render(<POSPage />);
    await addBurger();
    await charge();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0]![1].description).toMatch(/can't keep a safe copy/);
    expect(persistence.persistFinalizedPOSSaleAtomic).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

});
