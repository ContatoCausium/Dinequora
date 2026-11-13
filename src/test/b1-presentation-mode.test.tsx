import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import { roleDefaults, type Permission } from "@/lib/permissions";
import type { Location } from "@/lib/tenants";

/**
 * B1 (E2E 2026-11-13): an organization classified as demo (organizations.is_demo — every organization
 * created by onboarding) recorded real sales, but the Dashboard, the notifications, the store cards
 * and the kitchen board showed synthetic numbers instead. Real data is now the default for every
 * organization; the synthetic showcase exists only while presentation mode is explicitly on.
 * The workspace and the server functions are mocked; no database is touched.
 */
const api = vi.hoisted(() => ({
  fetchOperationalOrders: vi.fn(),
  fetchOperationalResources: vi.fn(),
  // Writes: none of these may ever be called by the screens under test.
  submitOperationalSale: vi.fn(),
  changeOperationalOrder: vi.fn(),
  setOperationalItemReady: vi.fn(),
  saveOperationalRecord: vi.fn(),
}));
const persistence = vi.hoisted(() => ({ persistOrderStatusTransition: vi.fn() }));
const orgService = vi.hoisted(() => ({ fetchTeam: vi.fn(), setLocationStatus: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const workspace = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const channel = vi.hoisted(() => {
  const c: Record<string, unknown> = {};
  c["on"] = () => c;
  c["subscribe"] = () => c;
  return c;
});

// jsdom has no ResizeObserver; the showcase charts (recharts ResponsiveContainer) need one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock("@/lib/operational.functions", () => api);
vi.mock("@/lib/orders-persistence-service", () => persistence);
vi.mock("@/lib/org-service", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...orgService,
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel: () => channel, removeChannel: vi.fn() },
}));
vi.mock("@/components/app/workspace-context", () => ({
  useWorkspace: () => workspace.current,
  useScopedLocations: () => (workspace.current["org"] as { locations: Location[] }).locations,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: "/" } }),
}));

import {
  isPresentationActive,
  presentationKey,
  startPresentation,
  stopPresentation,
} from "@/lib/presentation-mode";
import { PresentationBanner, PresentationModeToggle } from "@/components/app/presentation-mode";
import { OverviewEntry } from "@/routes/_authenticated/_app/index";
import { Notifications } from "@/components/app/app-shell";
import { LocationsPage } from "@/routes/_authenticated/_app/locations";
import { KDSPage } from "@/routes/_authenticated/_app/kds";

// ── Fixtures: the E2E store and sale #4EB368F9 (2× Burger, Fries, Lemonade; 3100 + 217 = 3317) ──
const STORE = {
  id: "loc-harbor",
  dbId: "db-loc-harbor",
  name: "Harbor Test Kitchen",
  status: "verified",
  lifecycle: "active",
  timezone: "America/New_York",
  taxRatePpm: 70000,
  demoScale: 1,
} satisfies Location;

function setWorkspace(opts: { fictional: boolean; orgId?: string; userId?: string }) {
  const perms = new Set<Permission>(roleDefaults("owner"));
  workspace.current = {
    role: "owner",
    can: (p: Permission) => perms.has(p),
    canAny: (ps: Permission[]) => ps.some((p) => perms.has(p)),
    user: { id: opts.userId ?? "user-1", fullName: "QA Owner", email: "owner@example.test" },
    org: {
      id: opts.orgId ?? "org_e2e",
      name: "Dinequora E2E QA Lab",
      initials: "DE",
      fictional: opts.fictional,
      // What org-service gives every organization loaded from the database (no bundled showcase menu).
      categories: [],
      topItems: [],
      locations: [STORE],
    },
    orgDbId: "db-org",
    locationId: STORE.id,
    setLocationId: vi.fn(),
    refresh: vi.fn(),
    storeLimit: 1,
    orgStatus: "trial",
  };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const SALE_AT = minutesAgo(60);
const SALE = {
  id: "4eb368f9-9b70-4fa8-b0fb-e1d060f55b7c",
  orgId: "org_e2e",
  locationId: STORE.id,
  orderNumber: "#4EB368F9",
  type: "dine_in",
  status: "delivered",
  customer: { name: "Walk-in", phone: "" },
  items: [
    {
      id: "i1",
      productId: "p1",
      productName: "QA Classic Burger",
      quantity: 2,
      basePriceCents: 1200,
      subtotalCents: 2400,
      isItemReady: true,
      modifiers: [],
    },
    {
      id: "i2",
      productId: "p2",
      productName: "QA French Fries",
      quantity: 1,
      basePriceCents: 400,
      subtotalCents: 400,
      isItemReady: true,
      modifiers: [],
    },
    {
      id: "i3",
      productId: "p3",
      productName: "QA Lemonade",
      quantity: 1,
      basePriceCents: 300,
      subtotalCents: 300,
      isItemReady: true,
      modifiers: [],
    },
  ],
  subtotalCents: 3100,
  discountCents: 0,
  taxRatePpm: 70000,
  taxCents: 217,
  totalCents: 3317,
  createdAt: SALE_AT,
  updatedAt: SALE_AT,
  isSimulated: false,
  createdBy: "user-1",
  paid: true,
  timeline: [],
};
const ledgerRow = (kind: string, amount: number) => ({
  id: `f-${kind}`,
  location_id: STORE.dbId,
  order_id: SALE.id,
  kind,
  amount_cents: amount,
  created_at: SALE_AT,
});
const inventoryRow = (name: string, unit: string, quantity: number, cost: number) => ({
  id: `inv-${name}`,
  location_id: STORE.dbId,
  name,
  category: "dry_goods",
  sku: "",
  unit,
  quantity,
  min_quantity: 0,
  cost_cents: cost,
  supplier: "",
  active: true,
  updated_at: SALE_AT,
  expiration_date: null,
});
function serve(opts: { sales: boolean; openTicket?: boolean }) {
  const orders = opts.sales ? [SALE] : [];
  const open = opts.openTicket
    ? [
        {
          ...SALE,
          id: "open-1",
          orderNumber: "#OPEN0001",
          status: "confirmed",
          createdAt: minutesAgo(2),
        },
      ]
    : [];
  api.fetchOperationalOrders.mockImplementation(
    async ({ data }: { data: { statuses?: string[]; status?: string } }) => {
      const all = [...orders, ...open];
      const rows = all.filter((o) =>
        data.statuses
          ? data.statuses.includes(o.status)
          : data.status
            ? o.status === data.status
            : true,
      );
      return { orders: rows, totalCount: rows.length };
    },
  );
  api.fetchOperationalResources.mockResolvedValue({
    orgId: "org_e2e",
    locations: [{ id: STORE.dbId, slug: STORE.id }],
    costsVisible: true,
    inventory: [
      inventoryRow("Burger bun", "units", opts.sales ? 48 : 50, 40),
      inventoryRow("Beef patty", "units", opts.sales ? 38 : 40, 150),
      inventoryRow("Cheese slice", "units", opts.sales ? 58 : 60, 20),
      inventoryRow("Potato", "lb", opts.sales ? 19.5 : 20, 80),
      inventoryRow("Lemonade base", "gal", opts.sales ? 4.9 : 5, 600),
    ],
    recipes: [],
    suppliers: [],
    purchases: [],
    movements: [],
    finance: opts.sales ? [ledgerRow("revenue", 3100), ledgerRow("cogs", 520)] : [],
    expenses: [],
  });
}

const withQuery = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
const userKey = () => {
  const w = workspace.current as { user: { id: string }; org: { id: string } };
  return presentationKey(w.user.id, w.org.id);
};
const DEMO_DISCLAIMER = /Presentation mode: every sales, order, inventory and alert figure/;
const expectNoWrites = () => {
  for (const fn of [
    api.submitOperationalSale,
    api.changeOperationalOrder,
    api.setOperationalItemReady,
    api.saveOperationalRecord,
    persistence.persistOrderStatusTransition,
  ])
    expect(fn).not.toHaveBeenCalled();
};

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  stopPresentation();
  vi.clearAllMocks();
  localStorage.clear();
  orgService.fetchTeam.mockResolvedValue({ members: [], invitations: [] });
});
afterEach(() => {
  cleanup();
  stopPresentation();
});

describe("presentation mode state (memory only, explicit, per user and organization)", () => {
  it("is off by default and only an explicit start turns it on", () => {
    const key = presentationKey("user-1", "org_e2e");
    expect(isPresentationActive(key)).toBe(false);
    startPresentation(key);
    expect(isPresentationActive(key)).toBe(true);
    stopPresentation();
    expect(isPresentationActive(key)).toBe(false);
  });

  it("belongs to one user and one organization (no carry-over between tenants or accounts)", () => {
    startPresentation(presentationKey("user-1", "org_a"));
    expect(isPresentationActive(presentationKey("user-1", "org_b"))).toBe(false);
    expect(isPresentationActive(presentationKey("user-2", "org_a"))).toBe(false);
  });

  it("is never persisted: no storage write, and a fresh module (reload / new session) starts off", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k: string,
    ) {
      writes.push(k);
    });
    startPresentation(presentationKey("user-1", "org_e2e"));
    stopPresentation();
    spy.mockRestore();
    expect(writes).toEqual([]);
    expect(document.cookie).not.toMatch(/present/i);

    startPresentation(presentationKey("user-1", "org_e2e"));
    vi.resetModules();
    const fresh = await import("@/lib/presentation-mode");
    expect(fresh.isPresentationActive(fresh.presentationKey("user-1", "org_e2e"))).toBe(false);
  });
});

describe("dashboard: real figures by default for every organization", () => {
  it("1. new organization without sales: zeroed indicators, nothing invented", async () => {
    setWorkspace({ fictional: false });
    serve({ sales: false });
    withQuery(<OverviewEntry />);
    await waitFor(() => expect(api.fetchOperationalResources).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0));
    expect(screen.queryByText(/\$84,|3,439|\$24\.53/)).toBeNull();
    expect(screen.queryByText(DEMO_DISCLAIMER)).toBeNull();
  });

  it("2. operational organization with sales: revenue, orders, ticket, COGS, profit and margin are the recorded ones", async () => {
    setWorkspace({ fictional: false });
    serve({ sales: true });
    withQuery(<OverviewEntry />);
    await waitFor(() => expect(screen.getAllByText("$31.00").length).toBeGreaterThan(0));
    expect(screen.getAllByText("$5.20").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$25.80").length).toBeGreaterThan(0);
    expect(screen.getByText(/16\.8%/)).toBeTruthy(); // COGS rate 520 / 3100
    expect(api.fetchOperationalResources).toHaveBeenCalledWith({
      data: { orgId: "org_e2e", locationId: STORE.id },
    });
    expectNoWrites();
  });

  it("3. organization classified as demo WITH sales: the same real figures, no synthetic numbers", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: true });
    withQuery(<OverviewEntry />);
    await waitFor(() => expect(screen.getAllByText("$31.00").length).toBeGreaterThan(0));
    expect(screen.getAllByText("$5.20").length).toBeGreaterThan(0);
    expect(screen.queryByText(DEMO_DISCLAIMER)).toBeNull();
    expect(screen.queryByText("Demo data")).toBeNull();
  });

  it("4. organization classified as demo WITHOUT sales: honest empty state, not a showcase", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: false });
    withQuery(<OverviewEntry />);
    await waitFor(() => expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0));
    expect(screen.queryByText(DEMO_DISCLAIMER)).toBeNull();
  });

  it("5–7. commercial demo: real by default; showcase only after an explicit start, clearly labelled; leaving returns to real data", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: true });
    withQuery(
      <>
        <PresentationModeToggle />
        <PresentationBanner />
        <OverviewEntry />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText("$31.00").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("presentation-banner")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Presentation mode" }));
    expect(isPresentationActive(userKey())).toBe(true);
    expect(screen.getByTestId("presentation-banner").textContent).toMatch(
      /Presentation mode on: illustrative data/,
    );
    expect(screen.getByText(DEMO_DISCLAIMER)).toBeTruthy();
    expect(screen.getAllByText("Demo data").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Leave presentation mode", pressed: true }),
    ).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Leave presentation mode" })[0]!);
    expect(isPresentationActive(userKey())).toBe(false);
    await waitFor(() => expect(screen.getAllByText("$31.00").length).toBeGreaterThan(0));
    expect(screen.queryByText(DEMO_DISCLAIMER)).toBeNull();
    expect(screen.queryByTestId("presentation-banner")).toBeNull();
    expectNoWrites();
  });

  it("8. a new session starts with the mode off even if it was on before sign-out", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: true });
    startPresentation(userKey());
    stopPresentation(); // what the sign-out listeners call
    withQuery(<OverviewEntry />);
    await waitFor(() => expect(screen.getAllByText("$31.00").length).toBeGreaterThan(0));
    expect(screen.queryByText(DEMO_DISCLAIMER)).toBeNull();
  });

  it("non-demo organizations are never offered the showcase", () => {
    setWorkspace({ fictional: false });
    render(<PresentationModeToggle />);
    expect(screen.queryByRole("button", { name: "Presentation mode" })).toBeNull();
    act(() => startPresentation(userKey())); // even a stray start does not apply to a real organization
    serve({ sales: false });
    withQuery(<OverviewEntry />);
    expect(screen.queryByText(DEMO_DISCLAIMER)).toBeNull();
  });

  it("9. dashboard alerts are the recorded ones: no invented low-stock, late-order, refund or cash-closing alert", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: true });
    withQuery(<OverviewEntry />);
    await waitFor(() => expect(screen.getAllByText("$31.00").length).toBeGreaterThan(0));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(
      /below minimum|running late|refunds? (awaiting|pending)|not closed|day close/i,
    );
  });
});

describe("notifications", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

  it("10. demo organization: no synthetic alert by default, honest empty state", () => {
    setWorkspace({ fictional: true });
    render(<Notifications />);
    open();
    expect(screen.getByText("No notifications right now.")).toBeTruthy();
    expect(screen.queryByText("Demo data")).toBeNull();
  });

  it("only in presentation mode the sample alerts appear, labelled as demo data", () => {
    setWorkspace({ fictional: true });
    startPresentation(userKey());
    render(<Notifications />);
    open();
    expect(screen.queryByText("No notifications right now.")).toBeNull();
    expect(screen.getByText("Demo data")).toBeTruthy();
  });
});

describe("stores (Locations)", () => {
  it("11. demo organization: each store shows its recorded sales by default", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: true });
    withQuery(<LocationsPage />);
    await waitFor(() => expect(api.fetchOperationalOrders).toHaveBeenCalled());
    expect(api.fetchOperationalOrders.mock.calls[0]![0].data.orgId).toBe("org_e2e");
    await waitFor(() => expect(screen.getByText("$31")).toBeTruthy());
    expect(screen.queryByText("Demo data")).toBeNull();
    expectNoWrites();
  });

  it("in presentation mode the cards switch to illustrative figures, labelled, without reading orders", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: true });
    startPresentation(userKey());
    withQuery(<LocationsPage />);
    expect(screen.getByText("Demo data")).toBeTruthy();
    expect(api.fetchOperationalOrders).not.toHaveBeenCalled();
    expect(screen.queryByText("$31")).toBeNull();
  });
});

describe("kitchen board (KDS)", () => {
  it("12–13. demo organization: real tickets only, no 'Simulate order' by default", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: false, openTicket: true });
    withQuery(<KDSPage />);
    await waitFor(() => expect(screen.getByText("#OPEN0001")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Simulate order" })).toBeNull();
    expect(document.querySelectorAll("article")).toHaveLength(1);
    expectNoWrites();
  });

  it("presentation mode: simulated tickets stay in the browser (no server write); leaving reloads the real board", async () => {
    setWorkspace({ fictional: true });
    serve({ sales: false, openTicket: true });
    startPresentation(userKey());
    withQuery(<KDSPage />);
    await waitFor(() => expect(screen.getByText("#OPEN0001")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Simulate order" }));
    expect(toast.info).toHaveBeenCalled();
    expectNoWrites();

    const reads = api.fetchOperationalOrders.mock.calls.length;
    act(() => stopPresentation());
    await waitFor(() =>
      expect(api.fetchOperationalOrders.mock.calls.length).toBeGreaterThan(reads),
    );
    await waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(1));
    expect(screen.getByText("#OPEN0001")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Simulate order" })).toBeNull();
    expectNoWrites();
  });
});

describe("14. tenant isolation of the mode and of the reads", () => {
  it("turning the showcase on for one organization leaves another organization on real data", async () => {
    setWorkspace({ fictional: true, orgId: "org_a" });
    startPresentation(userKey());
    setWorkspace({ fictional: true, orgId: "org_b" });
    serve({ sales: true });
    withQuery(<OverviewEntry />);
    await waitFor(() => expect(screen.getAllByText("$31.00").length).toBeGreaterThan(0));
    expect(screen.queryByText(DEMO_DISCLAIMER)).toBeNull();
    expect(api.fetchOperationalResources).toHaveBeenCalledWith({
      data: { orgId: "org_b", locationId: STORE.id },
    });
  });
});
