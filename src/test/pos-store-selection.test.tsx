import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { roleDefaults, type Permission } from "@/lib/permissions";
import type { OrgRole } from "@/lib/access-rules";
import { resolvePosStore, posEligibleStores } from "@/lib/pos-store";
import type { Location } from "@/lib/tenants";

/**
 * Which store the point of sale records sales in (src/lib/pos-store.ts and the POS route), with the
 * workspace, the menu and the sale persistence mocked. The server-side checks of the same rules
 * (create_pos_sale_v2 -> assert_operational_scope -> can_operate_location) are covered by
 * scripts/security/reconstructed_operations.sql and the permission matrix.
 */
const api = vi.hoisted(() => ({ fetchOperationalMenu: vi.fn() }));
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
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { POSPage } from "@/routes/_authenticated/_app/pos";

type Lifecycle = "active" | "inactive" | "placeholder";
const store = (id: string, lifecycle: Lifecycle = "active", over: Partial<Location> = {}) =>
  ({
    id,
    dbId: `db-${id}`,
    name: id[0]!.toUpperCase() + id.slice(1),
    status: lifecycle === "placeholder" ? "placeholder" : "verified",
    lifecycle,
    timezone: "America/New_York",
    taxRatePpm: 62500,
    demoScale: 1,
    ...over,
  }) satisfies Location;

const setLocationId = vi.fn();
const refresh = vi.fn();
function setWorkspace(
  role: OrgRole,
  locations: Location[],
  locationId = "all",
  org: { id: string; name: string } = { id: "org-1", name: "Test Kitchen" },
) {
  const perms = new Set<Permission>(roleDefaults(role));
  workspace.current = {
    role,
    can: (p: Permission) => perms.has(p),
    canAny: (ps: Permission[]) => ps.some((p) => perms.has(p)),
    user: { id: "user-1", fullName: "Pat Cashier", email: "pat@example.test" },
    org: { ...org, initials: "TK", fictional: false, locations },
    locationId,
    setLocationId,
    refresh,
  };
}
const patchWorkspace = (over: Record<string, unknown>) =>
  (workspace.current = { ...workspace.current, ...over });
const orgOf = () => workspace.current["org"] as { id: string; name: string; locations: Location[] };

const menuItem = (id: string, name: string, locationIds: string[] = []) => ({
  id,
  orgId: "org-1",
  name,
  description: "",
  category: "mains",
  priceCents: 1000,
  prepTimeMinutes: 5,
  active: true,
  locationIds,
  modifierGroups: [],
  createdAt: "2026-11-01T00:00:00.000Z",
});
const MENU = {
  categories: [{ id: "mains", name: "Mains" }],
  archivedCategories: [],
  items: [
    menuItem("burger", "Classic Burger"),
    menuItem("a-only", "Placeholder Special", ["a-placeholder"]),
    menuItem("riverside-only", "River Fish", ["riverside"]),
  ],
};

/** The ticket the register sent for its first sale. */
const saleArg = () => persistence.persistFinalizedPOSSaleAtomic.mock.calls[0]?.[0];
const ticketStore = () => screen.getByTestId("pos-store").textContent;
const addBurger = async () =>
  fireEvent.click(await screen.findByRole("button", { name: /^Add Classic Burger,/ }));
const chargeButton = () => screen.getByRole("button", { name: /^Charge / });
async function charge() {
  fireEvent.click(chargeButton());
  fireEvent.click(await screen.findByRole("button", { name: "Confirm payment" }));
}
const confirmed = (n: number) => ({
  success: true,
  orderId: `order-${n}`,
  orderNumber: `#A${n}`,
  subtotalCents: 1000,
  taxCents: 63,
  totalCents: 1063,
  isSimulation: false,
});

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  localStorage.clear();
  api.fetchOperationalMenu.mockReset().mockResolvedValue(MENU);
  persistence.persistFinalizedPOSSaleAtomic.mockReset().mockResolvedValue(confirmed(1));
  persistence.cancelOrderWithReversal.mockReset();
  for (const f of [toast.success, toast.error, toast.info, setLocationId, refresh]) f.mockReset();
});
afterEach(() => cleanup());

describe("resolvePosStore (pure)", () => {
  const locs = [store("a-placeholder", "placeholder"), store("b-closed", "inactive"), store("c")];

  it("never picks an inactive or placeholder store, whatever its position or name", () => {
    expect(resolvePosStore(locs, "all")).toEqual({ kind: "ready", store: locs[2] });
    expect(posEligibleStores(locs).map((l) => l.id)).toEqual(["c"]);
    // a store named like a real one but inactive is still not eligible; the name is never read
    const renamed = [store("main-street", "inactive", { name: "Main Street (open)" }), store("z")];
    expect(resolvePosStore(renamed, "all")).toMatchObject({ kind: "ready", store: { id: "z" } });
    // lifecycle missing (not loaded from the database) is not "active"
    expect(resolvePosStore([store("x", "active", { lifecycle: undefined })], "all").kind).toBe(
      "none",
    );
  });

  it("asks to choose when several stores can sell, instead of taking the first by slug", () => {
    const two = [store("downtown"), store("riverside")];
    expect(resolvePosStore(two, "all")).toEqual({ kind: "choose", stores: two });
  });

  it("explains a selected store that cannot sell, offering the stores that can", () => {
    expect(resolvePosStore(locs, "b-closed")).toEqual({
      kind: "unavailable",
      reason: "inactive",
      store: locs[1],
      stores: [locs[2]],
    });
    expect(resolvePosStore(locs, "gone")).toMatchObject({
      kind: "unavailable",
      reason: "notAuthorized",
      stores: [locs[2]],
    });
  });

  it("reports no eligible store at all", () => {
    expect(resolvePosStore([store("a", "inactive")], "all")).toEqual({
      kind: "none",
      inactiveCount: 1,
    });
    expect(resolvePosStore([], "all")).toEqual({ kind: "none", inactiveCount: 0 });
  });
});

describe("POS store selection by role", () => {
  it("owner with one active and two inactive stores: opens on the active one only", async () => {
    // sorted by slug the placeholder comes first: it used to be the store the POS sold in
    setWorkspace("owner", [
      store("a-placeholder", "placeholder"),
      store("b-closed", "inactive"),
      store("c-main"),
    ]);
    render(<POSPage />);
    await addBurger();
    expect(ticketStore()).toBe("Store: C-main");
    expect(screen.queryByText("Placeholder Special")).toBeNull();
    await charge();
    await waitFor(() => expect(persistence.persistFinalizedPOSSaleAtomic).toHaveBeenCalledTimes(1));
    expect(saleArg()).toMatchObject({
      orgId: "org-1",
      locationId: "c-main",
      taxRatePpm: 62500,
    });
  });

  it("owner with several active stores: a clear choice, no register until one is chosen", async () => {
    setWorkspace("owner", [store("downtown"), store("riverside"), store("uptown", "inactive")]);
    render(<POSPage />);
    expect(screen.getByText("Choose the store for this register")).toBeInTheDocument();
    expect(screen.queryByText("Current ticket")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sell at Uptown" })).toBeNull();
    expect(api.fetchOperationalMenu).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sell at Riverside" }));
    expect(setLocationId).toHaveBeenCalledWith("riverside");
  });

  it("a valid store already selected in the workspace is kept", async () => {
    setWorkspace("owner", [store("downtown"), store("riverside")], "riverside");
    render(<POSPage />);
    await addBurger();
    expect(ticketStore()).toBe("Store: Riverside");
    expect(screen.getByText("River Fish")).toBeInTheDocument();
  });

  it("manager with partially authorized stores: only an active authorized store", async () => {
    // fetchMemberships gives a manager only the assigned stores (here one active, one inactive)
    setWorkspace("manager", [store("riverside"), store("uptown", "inactive")]);
    render(<POSPage />);
    await addBurger();
    expect(ticketStore()).toBe("Store: Riverside");
    await charge();
    await waitFor(() => expect(persistence.persistFinalizedPOSSaleAtomic).toHaveBeenCalled());
    expect(saleArg().locationId).toBe("riverside");
  });

  it("staff with one authorized store sells there", async () => {
    setWorkspace("staff", [store("downtown")]);
    render(<POSPage />);
    await addBurger();
    expect(ticketStore()).toBe("Store: Downtown");
    expect(screen.queryByText("River Fish")).toBeNull();
  });

  it("no eligible store: an explanatory empty state, with the next step for each role", async () => {
    setWorkspace("owner", [store("a", "inactive"), store("b", "placeholder")]);
    render(<POSPage />);
    expect(screen.getByText("No store can record sales")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Locations" })).toHaveAttribute(
      "href",
      "/locations",
    );
    expect(screen.queryByRole("button", { name: /^Charge / })).toBeNull();
    expect(api.fetchOperationalMenu).not.toHaveBeenCalled();
    cleanup();

    setWorkspace("staff", []);
    render(<POSPage />);
    expect(screen.getByText(/Ask the account owner to assign you one/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to Locations" })).toBeNull();
  });

  it("a selected inactive store does not open the register and offers the active ones", () => {
    setWorkspace("owner", [store("downtown"), store("closed", "inactive")], "closed");
    render(<POSPage />);
    expect(screen.getByText("Closed is not active")).toBeInTheDocument();
    expect(screen.queryByText("Current ticket")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sell at Downtown" }));
    expect(setLocationId).toHaveBeenCalledWith("downtown");
  });
});

describe("store changes while the POS is open", () => {
  it("a sale in progress is not moved to another store when the workspace store changes", async () => {
    setWorkspace("owner", [store("downtown"), store("riverside", "active", { taxRatePpm: 88750 })]);
    patchWorkspace({ locationId: "downtown" });
    const view = render(<POSPage />);
    await addBurger();
    patchWorkspace({ locationId: "riverside" });
    view.rerender(<POSPage />);
    expect(ticketStore()).toBe("Store: Downtown");
    expect(screen.getByRole("status")).toHaveTextContent(
      "This ticket belongs to Downtown. Charge, hold or clear it to switch to Riverside.",
    );
    await charge();
    await waitFor(() => expect(persistence.persistFinalizedPOSSaleAtomic).toHaveBeenCalled());
    expect(saleArg()).toMatchObject({
      locationId: "downtown",
      taxRatePpm: 62500,
    });
    // the receipt still belongs to Downtown; once it is closed the register follows the workspace
    expect(ticketStore()).toBe("Store: Downtown");
    const closes = await screen.findAllByRole("button", { name: "Close" });
    fireEvent.click(closes[closes.length - 1]!);
    await waitFor(() => expect(ticketStore()).toBe("Store: Riverside"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an empty ticket follows the workspace store at once", async () => {
    setWorkspace("owner", [store("downtown"), store("riverside")], "downtown");
    const view = render(<POSPage />);
    await screen.findByRole("button", { name: /^Add Classic Burger,/ });
    patchWorkspace({ locationId: "riverside" });
    view.rerender(<POSPage />);
    await waitFor(() => expect(ticketStore()).toBe("Store: Riverside"));
  });

  it("store deactivated while the POS is open with an empty ticket: the register closes", async () => {
    setWorkspace("owner", [store("downtown"), store("riverside")], "downtown");
    const view = render(<POSPage />);
    await screen.findByRole("button", { name: /^Add Classic Burger,/ });
    patchWorkspace({
      org: { ...orgOf(), locations: [store("downtown", "inactive"), store("riverside")] },
    });
    view.rerender(<POSPage />);
    expect(screen.getByText("Downtown is not active")).toBeInTheDocument();
    expect(screen.queryByText("Current ticket")).toBeNull();
  });

  it("store deactivated with a ticket open: it can no longer be charged, only held or cleared", async () => {
    setWorkspace("manager", [store("downtown")]);
    const view = render(<POSPage />);
    await addBurger();
    patchWorkspace({ org: { ...orgOf(), locations: [store("downtown", "inactive")] } });
    view.rerender(<POSPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Downtown is no longer active, so this ticket can’t be charged.",
    );
    expect(chargeButton()).toBeDisabled();
    fireEvent.click(chargeButton());
    expect(persistence.persistFinalizedPOSSaleAtomic).not.toHaveBeenCalled();
    // holding keeps the ticket for that store; the register then explains why it cannot sell
    fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    await waitFor(() => expect(screen.getByText("No store can record sales")).toBeInTheDocument());
    const held = JSON.parse(localStorage.getItem("servora.pos.suspended.org-1") ?? "[]");
    expect(held).toHaveLength(1);
    expect(held[0].locationId).toBe("downtown");
  });

  it("server refuses the store at confirmation: the workspace reloads, nothing is recorded", async () => {
    setWorkspace("staff", [store("downtown")]);
    persistence.persistFinalizedPOSSaleAtomic.mockResolvedValue({
      success: false,
      error: "forbidden",
    });
    render(<POSPage />);
    await addBurger();
    await charge();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0]).toEqual([
      "The sale was NOT confirmed",
      {
        description:
          "This store can no longer record sales: it was deactivated or your access changed. Nothing was charged.",
      },
    ]);
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Confirm payment" })).toBeNull();
    // the ticket is kept (nothing was charged)
    expect(screen.getByRole("button", { name: /^Remove Classic Burger/ })).toBeInTheDocument();
  });

  it("clearing a ticket keeps the store's sales-tax rate", async () => {
    setWorkspace("owner", [store("downtown")]);
    render(<POSPage />);
    await addBurger();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear ticket" }));
    expect(screen.queryByText(/Sales tax is not configured for this store/)).toBeNull();
    expect(screen.getByText("Tax (6.25%)")).toBeInTheDocument();
  });
});

describe("organization switch", () => {
  it("never carries a ticket into another tenant: it is held in its own organization", async () => {
    setWorkspace("owner", [store("downtown")]);
    const view = render(<POSPage />);
    await addBurger();
    setWorkspace("owner", [store("harbor-main")], "all", { id: "org-2", name: "Other Kitchen" });
    await act(async () => view.rerender(<POSPage />));
    await waitFor(() => expect(ticketStore()).toBe("Store: Harbor-main"));
    expect(toast.info).toHaveBeenCalledWith("The open ticket was put on hold in Test Kitchen.");
    // the new organization's register starts empty and does not list the other tenant's ticket
    expect(screen.queryByRole("button", { name: /^Remove Classic Burger/ })).toBeNull();
    expect(screen.queryByText("On hold")).toBeNull();
    const heldOrg1 = JSON.parse(localStorage.getItem("servora.pos.suspended.org-1") ?? "[]");
    expect(heldOrg1).toHaveLength(1);
    expect(heldOrg1[0]).toMatchObject({ orgId: "org-1", locationId: "downtown" });
    expect(localStorage.getItem("servora.pos.suspended.org-2")).toBeNull();
    await screen.findByRole("button", { name: /^Add Classic Burger,/ });
    fireEvent.click(screen.getByRole("button", { name: /^Add Classic Burger,/ }));
    await charge();
    await waitFor(() => expect(persistence.persistFinalizedPOSSaleAtomic).toHaveBeenCalled());
    expect(saleArg()).toMatchObject({
      orgId: "org-2",
      locationId: "harbor-main",
    });
  });

  it("switching organization with an empty ticket holds nothing", async () => {
    setWorkspace("owner", [store("downtown")]);
    const view = render(<POSPage />);
    await screen.findByRole("button", { name: /^Add Classic Burger,/ });
    setWorkspace("owner", [store("a"), store("b")], "all", { id: "org-2", name: "Other" });
    await act(async () => view.rerender(<POSPage />));
    expect(screen.getByText("Choose the store for this register")).toBeInTheDocument();
    expect(toast.info).not.toHaveBeenCalled();
    expect(localStorage.getItem("servora.pos.suspended.org-1")).toBeNull();
  });
});
