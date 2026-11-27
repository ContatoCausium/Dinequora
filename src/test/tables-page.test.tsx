import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { roleDefaults, type Permission } from "@/lib/permissions";
import { requiredFor } from "@/lib/route-permissions";
import {
  countByStatus,
  diningErrorKey,
  groupFloor,
  seatsByStatus,
  toDiningRoom,
  toOpenSessions,
  equalShares,
  itemsShareCents,
  parseMoneyInput,
  summarizeDay,
  type DiningRoom,
} from "@/lib/dining-room";

/**
 * Tables screen (dining room step 1, migration 0037) with the workspace and the server functions
 * mocked: what each permission set is offered, the status change sends the status the screen showed,
 * a conflict is explained and never overwritten, refusals are translated. The RPCs, RLS, the feature
 * switch and concurrency are covered against a real database by
 * scripts/security/dining_tables_integrity.mjs.
 */
const api = vi.hoisted(() => ({
  fetchDiningRoom: vi.fn(),
  saveDiningSection: vi.fn(),
  archiveDiningSection: vi.fn(),
  saveDiningTable: vi.fn(),
  archiveDiningTable: vi.fn(),
  setDiningTableStatus: vi.fn(),
  fetchOperationalMenu: vi.fn(),
  openDiningSession: vi.fn(),
  openDiningCheck: vi.fn(),
  fireCheckRound: vi.fn(),
  moveDiningSession: vi.fn(),
  closeEmptyDiningSession: vi.fn(),
  updateDiningSession: vi.fn(),
  changeOperationalOrder: vi.fn(),
  payDiningCheck: vi.fn(),
  voidCheckPayment: vi.fn(),
  moveCheckRound: vi.fn(),
  fetchDiningDaySummary: vi.fn(),
  fetchCheckHistory: vi.fn(),
  fetchClosedChecksToday: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const workspace = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/operational.functions", () => api);
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/app/workspace-context", () => ({
  useWorkspace: () => workspace.current,
}));

import { TablesPage } from "@/components/pages/tables-page";

const NOW = new Date().toISOString();
const sectionRow = (
  id: string,
  name: string,
  sort_order = 0,
  archived_at: string | null = null,
) => ({
  id,
  name,
  sort_order,
  archived_at,
});
const tableRow = (
  id: string,
  label: string,
  over: Partial<{
    seats: number;
    status: string;
    section_id: string | null;
    sort_order: number;
    archived_at: string | null;
  }> = {},
) => ({
  id,
  label,
  seats: 4,
  status: "available",
  section_id: null,
  sort_order: 0,
  status_changed_at: NOW,
  archived_at: null,
  ...over,
});
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PATIO = UUID(1);
const BAR = UUID(2);
const room = (): DiningRoom =>
  toDiningRoom(
    "store-1",
    [sectionRow(PATIO, "Patio", 1), sectionRow(BAR, "Bar", 2)],
    [
      tableRow(UUID(10), "T10", { section_id: PATIO }),
      tableRow(UUID(11), "T2", { section_id: PATIO, status: "occupied", seats: 2 }),
      tableRow(UUID(12), "B1", { section_id: BAR, status: "reserved" }),
      tableRow(UUID(13), "Window", { status: "cleaning", seats: 6 }),
    ],
  );

function setWorkspace(perms: readonly Permission[], stores = ["store-1"], locationId = "store-1") {
  const set = new Set<Permission>(perms);
  workspace.current = {
    role: "manager",
    can: (p: Permission) => set.has(p),
    canAny: (ps: Permission[]) => ps.some((p) => set.has(p)),
    org: {
      id: "org-1",
      name: "Test Kitchen",
      locations: stores.map((id, i) => ({
        id,
        name: i === 0 ? "Downtown" : `Store ${i + 1}`,
        status: "verified",
        timezone: "America/New_York",
      })),
    },
    locationId,
  };
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TablesPage />
    </QueryClientProvider>,
  );
}
async function openTable(label: RegExp) {
  const card = await screen.findByRole("button", { name: label });
  card.focus();
  fireEvent.keyDown(card, { key: "Enter" });
  return screen.findByRole("menu");
}

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  api.fetchDiningRoom.mockImplementation(async () => room());
  api.fetchDiningDaySummary.mockResolvedValue({
    day: "2026-11-27",
    checksClosed: 0,
    receivedCents: 0,
    tipsCents: 0,
    byServer: [],
    byMethod: [],
  });
});
afterEach(cleanup);

describe("dining room read model", () => {
  it("orders sections and tables naturally and drops archived rows", () => {
    const r = toDiningRoom(
      "s",
      [sectionRow("b", "Bar", 2), sectionRow("a", "Patio", 1), sectionRow("x", "Old", 0, NOW)],
      [
        tableRow("1", "T10"),
        tableRow("2", "T2"),
        tableRow("3", "Gone", { archived_at: NOW }),
        tableRow("4", "In old section", { section_id: "x" }),
        tableRow("5", "Weird", { status: "dirty" }),
      ],
    );
    expect(r.sections.map((s) => s.name)).toEqual(["Patio", "Bar"]);
    expect(r.tables.map((t) => t.label)).toEqual(["In old section", "T2", "T10", "Weird"]);
    // a table of an archived section is shown without a section; an unknown status is never shown
    expect(r.tables.find((t) => t.label === "In old section")?.sectionId).toBeNull();
    expect(r.tables.find((t) => t.label === "Weird")?.status).toBe("available");
  });

  it("groups the floor by section, filters by status and counts tables and seats", () => {
    const r = room();
    expect(
      groupFloor(r).map((g) => [g.section?.name ?? null, g.tables.map((t) => t.label)]),
    ).toEqual([
      ["Patio", ["T2", "T10"]],
      ["Bar", ["B1"]],
      [null, ["Window"]],
    ]);
    expect(groupFloor(r, "occupied").map((g) => g.tables.length)).toEqual([1, 0]);
    expect(countByStatus(r)).toEqual({ available: 1, occupied: 1, reserved: 1, cleaning: 1 });
    expect(seatsByStatus(r, "cleaning")).toBe(6);
  });

  it("maps RPC errors to message keys", () => {
    expect(diningErrorKey(new Error("table_label_taken"))).toBe("table_label_taken");
    expect(diningErrorKey(new Error("permission_denied"))).toBe("permission_denied");
    expect(diningErrorKey(new Error("boom"))).toBe("unknown");
  });

  it("the route is open to any of the tables permissions", () => {
    expect(requiredFor("/tables")).toEqual([
      "tables.view",
      "tables.status",
      "tables.serve",
      "tables.manage",
    ]);
  });
});

describe("Tables screen", () => {
  it("asks for a store when the workspace shows all stores", async () => {
    setWorkspace(roleDefaults("manager"), ["store-1", "store-2"], "all");
    renderPage();
    expect(await screen.findByText("Choose a store")).toBeInTheDocument();
    expect(api.fetchDiningRoom).not.toHaveBeenCalled();
  });

  it("shows the floor with sections, summary and filter", async () => {
    setWorkspace(roleDefaults("manager"));
    renderPage();
    expect(await screen.findByRole("heading", { name: /Patio/ })).toBeInTheDocument();
    expect(api.fetchDiningRoom).toHaveBeenCalledWith({
      data: { orgId: "org-1", locationId: "store-1" },
    });
    expect(screen.getByRole("heading", { name: /No section/ })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Floor summary" });
    expect(within(summary).getByText("6 seats")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Occupied (1)" }));
    expect(screen.queryByRole("button", { name: /^Table T10,/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Table T2,/ })).toBeInTheDocument();
  });

  it("changes a status sending the status the screen showed", async () => {
    setWorkspace(roleDefaults("manager"));
    api.setDiningTableStatus.mockResolvedValue({ conflict: false, status: "occupied" });
    renderPage();
    const menu = await openTable(/^Table T10, Available/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Mark as occupied" }));
    await waitFor(() =>
      expect(api.setDiningTableStatus).toHaveBeenCalledWith({
        data: {
          orgId: "org-1",
          locationId: "store-1",
          id: UUID(10),
          status: "occupied",
          expected: "available",
        },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Table T10 is now Occupied."));
    expect(api.fetchDiningRoom.mock.calls.length).toBeGreaterThan(1);
  });

  it("explains a conflict and reloads, never overwriting it", async () => {
    setWorkspace(roleDefaults("manager"));
    api.setDiningTableStatus.mockResolvedValue({ conflict: true, status: "reserved" });
    renderPage();
    const menu = await openTable(/^Table T10, Available/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Mark as cleaning" }));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Table T10 was already changed to Reserved by someone else. Nothing was overwritten; check the floor and try again.",
      ),
    );
    expect(api.setDiningTableStatus).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(api.fetchDiningRoom.mock.calls.length).toBeGreaterThan(1));
  });

  it("status only (cashier profile): status actions, no setup actions", async () => {
    setWorkspace(["tables.view", "tables.status"]);
    renderPage();
    const menu = await openTable(/^Table B1, Reserved/);
    expect(within(menu).getByRole("menuitem", { name: "Reserved (current)" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(menu).queryByRole("menuitem", { name: "Edit table" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Archive table" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New table" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Section Patio: actions/ })).toBeNull();
  });

  it("view only: tables are shown, nothing is actionable", async () => {
    setWorkspace(["tables.view"]);
    renderPage();
    expect(
      await screen.findByRole("group", { name: /^Table T10, Available, 4 seats$/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Table / })).toBeNull();
    expect(screen.queryByRole("button", { name: "New table" })).toBeNull();
  });

  it("translates a refusal from the database inside the form", async () => {
    setWorkspace(roleDefaults("manager"));
    api.saveDiningTable.mockRejectedValue(new Error("table_label_taken"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New table" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "T2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await within(dialog).findByText("There is already a table with this label in this store."),
    ).toBeInTheDocument();
    expect(api.saveDiningTable).toHaveBeenCalledWith({
      data: {
        orgId: "org-1",
        locationId: "store-1",
        id: null,
        label: "T2",
        seats: 4,
        sectionId: null,
        sortOrder: 0,
      },
    });
  });

  it("an empty floor invites a manager to add tables, and only a manager", async () => {
    api.fetchDiningRoom.mockImplementation(async () => toDiningRoom("store-1", [], []));
    setWorkspace(roleDefaults("manager"));
    renderPage();
    expect(await screen.findByText("No tables yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New table" }).length).toBeGreaterThan(0);
    cleanup();
    setWorkspace(["tables.view"]);
    renderPage();
    expect(
      await screen.findByText("A manager has not set up the floor of this store yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New table" })).toBeNull();
  });

  it("reads in Portuguese", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      setWorkspace(roleDefaults("manager"));
      renderPage();
      expect(
        await screen.findByRole("button", { name: /^Mesa T10, Disponível, 4 lugares/ }),
      ).toBeVisible();
      expect(screen.getByRole("radio", { name: "Limpeza (1)" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en-US");
    }
  });
});

/* ---------------------------------------------------------------- checks (0038) */
const SESSION = UUID(50);
const CHECK1 = UUID(51);
const CHECK_ANA = UUID(52);
const ORDER1 = UUID(60);
/** T2 is seated (3 guests) with check 1 (one round, 2 sodas) and Ana's empty check. */
const seatedRoom = (): DiningRoom =>
  toDiningRoom(
    "store-1",
    [sectionRow(PATIO, "Patio", 1)],
    [
      tableRow(UUID(10), "T10", { section_id: PATIO }),
      tableRow(UUID(11), "T2", { section_id: PATIO, status: "occupied" }),
    ],
    {
      taxRatePpm: 62500,
      sessions: toOpenSessions({
        sessions: [{ id: SESSION, table_id: UUID(11), guests: 3, server_id: "u1", opened_at: NOW }],
        checks: [
          { id: CHECK1, session_id: SESSION, status: "open", number: 1, label: null },
          { id: CHECK_ANA, session_id: SESSION, status: "open", number: 2, label: "Ana" },
        ],
        rounds: [{ check_id: CHECK1, order_id: ORDER1, round_no: 1, fired_at: NOW }],
        orders: [{ id: ORDER1, status: "new", total_cents: 584 }],
        items: [
          {
            order_id: ORDER1,
            product_name: "QA Soda",
            quantity: 2,
            subtotal_cents: 550,
            notes: null,
            order_item_modifiers: [],
          },
        ],
        profiles: [{ id: "u1", full_name: "Sam Server" }],
      }),
    },
  );
const MENU = {
  categories: [],
  archivedCategories: [],
  items: [
    {
      id: "prod-soda",
      name: "QA Soda",
      priceCents: 275,
      active: true,
      locationIds: [],
      modifierGroups: [],
      category: "",
    },
  ],
};

describe("open sessions read model", () => {
  it("keeps each check with its own rounds and totals, and the table total", () => {
    const [s] = seatedRoom().sessions;
    expect(s!.checks.map((c) => [c.number, c.label, c.liveTotalCents])).toEqual([
      [1, null, 584],
      [2, "Ana", 0],
    ]);
    expect(s!.liveTotalCents).toBe(584);
    expect(s!.serverName).toBe("Sam Server");
  });
});

describe("Tables screen: checks", () => {
  beforeEach(() => {
    api.fetchDiningRoom.mockImplementation(async () => seatedRoom());
    api.fetchOperationalMenu.mockResolvedValue(MENU);
  });

  it("a seated table shows the party and offers its check, never a manual status change", async () => {
    setWorkspace(roleDefaults("manager"));
    renderPage();
    const menu = await openTable(/^Table T2, Occupied, 3 guests · \$5\.84/);
    expect(within(menu).getByRole("menuitem", { name: "Open check" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Mark as/ })).toBeNull();
  });

  it("a free table offers to seat guests; seating sends the table, guests and a key", async () => {
    setWorkspace(roleDefaults("manager"));
    api.openDiningSession.mockResolvedValue({ id: UUID(70) });
    renderPage();
    const menu = await openTable(/^Table T10, Available/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Seat guests…" }));
    const dialog = await screen.findByRole("dialog", { name: "Seat guests at T10" });
    fireEvent.change(within(dialog).getByLabelText("Guests"), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Seat and open check" }));
    await waitFor(() => expect(api.openDiningSession).toHaveBeenCalledTimes(1));
    const arg = api.openDiningSession.mock.calls[0]![0].data;
    expect(arg).toMatchObject({
      orgId: "org-1",
      locationId: "store-1",
      tableId: UUID(10),
      guests: 4,
    });
    expect(typeof arg.clientKey).toBe("string");
  });

  it("each check keeps its own round: Ana's round goes to Ana's check; a retry reuses the key", async () => {
    setWorkspace(roleDefaults("manager"));
    api.fireCheckRound
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ id: UUID(80) });
    renderPage();
    const menu = await openTable(/^Table T2,/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open check" }));
    const sheet = await screen.findByRole("dialog", { name: "Check · T2" });
    expect(within(sheet).getByRole("button", { name: /^Check 1/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(sheet).getByText("2 × QA Soda")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /^Ana/ }));
    expect(within(sheet).getByText("Nothing sent yet.")).toBeInTheDocument();
    expect(within(sheet).getByText("Total of the table")).toBeInTheDocument();
    fireEvent.click(await within(sheet).findByRole("button", { name: /QA Soda/ }));
    const send = within(sheet).getByRole("button", { name: "Send 1 item to the kitchen" });
    fireEvent.click(send);
    await waitFor(() => expect(api.fireCheckRound).toHaveBeenCalledTimes(1));
    expect(
      await within(sheet).findByText("Something went wrong. Nothing was changed."),
    ).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Send 1 item to the kitchen" }));
    await waitFor(() => expect(api.fireCheckRound).toHaveBeenCalledTimes(2));
    const [first, second] = api.fireCheckRound.mock.calls.map((c) => c[0].data);
    expect(first).toMatchObject({
      checkId: CHECK_ANA,
      taxRatePpm: 62500,
      items: [{ productId: "prod-soda", quantity: 1, modifiers: [] }],
    });
    expect(second.clientKey).toBe(first.clientKey);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Round sent to the kitchen for T2 · Ana."),
    );
  });

  it("opens another check with an optional name", async () => {
    setWorkspace(roleDefaults("manager"));
    api.openDiningCheck.mockResolvedValue({ id: UUID(90) });
    renderPage();
    const menu = await openTable(/^Table T2,/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open check" }));
    const sheet = await screen.findByRole("dialog", { name: "Check · T2" });
    fireEvent.click(within(sheet).getByRole("button", { name: "New check" }));
    const dialog = await screen.findByRole("dialog", { name: "New check at T2" });
    fireEvent.change(within(dialog).getByLabelText("Name (optional)"), {
      target: { value: "Bia" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open check" }));
    await waitFor(() => expect(api.openDiningCheck).toHaveBeenCalledTimes(1));
    expect(api.openDiningCheck.mock.calls[0]![0].data).toMatchObject({
      sessionId: SESSION,
      label: "Bia",
    });
  });

  it("without pos.sell the round cannot be sent (the server also refuses)", async () => {
    setWorkspace(["tables.view", "tables.serve"]);
    renderPage();
    const menu = await openTable(/^Table T2,/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open check" }));
    const sheet = await screen.findByRole("dialog", { name: "Check · T2" });
    fireEvent.click(await within(sheet).findByRole("button", { name: /QA Soda/ }));
    expect(
      within(sheet).getByRole("button", { name: "Send 1 item to the kitchen" }),
    ).toBeDisabled();
    expect(
      within(sheet).getByText("Sending to the kitchen also needs permission to sell at the POS."),
    ).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- payments (0039) */
describe("payment helpers", () => {
  it("splits a balance in equal shares, the first ones carrying the odd cents", () => {
    expect(equalShares(1000, 3)).toEqual([334, 333, 333]);
    expect(equalShares(856, 2)).toEqual([428, 428]);
    expect(equalShares(5, 0)).toEqual([5]);
  });
  it("prices selected items with their share of the round tax", () => {
    // a round of 800 + 56 tax: one 400 item pays 400 + 28
    expect(
      itemsShareCents([{ subtotalCents: 400, roundSubtotalCents: 800, roundTaxCents: 56 }]),
    ).toBe(428);
  });
  it("reads typed dollars", () => {
    expect(parseMoneyInput("12")).toBe(1200);
    expect(parseMoneyInput("12,5")).toBe(1250);
    expect(parseMoneyInput("8.56")).toBe(856);
    expect(parseMoneyInput("1.234")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
  });
});

describe("Tables screen: paying a check", () => {
  beforeEach(() => {
    api.fetchDiningRoom.mockImplementation(async () => seatedRoom());
    api.fetchOperationalMenu.mockResolvedValue(MENU);
  });
  async function openCheck1() {
    const menu = await openTable(/^Table T2,/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open check" }));
    return screen.findByRole("dialog", { name: "Check · T2" });
  }

  it("charges the whole balance with a tip; cash shows the change", async () => {
    setWorkspace(roleDefaults("manager"));
    api.payDiningCheck.mockResolvedValue({
      paymentId: UUID(91),
      checkStatus: "closed",
      balanceCents: 0,
    });
    renderPage();
    const sheet = await openCheck1();
    expect(within(sheet).getByText("Left to pay")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Cash" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "20%" }));
    fireEvent.change(within(sheet).getByLabelText("Cash received"), { target: { value: "10" } });
    // 5.84 + 1.17 tip = 7.01; change 2.99
    expect(within(sheet).getByText("$2.99")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Charge $7.01 and close" }));
    await waitFor(() => expect(api.payDiningCheck).toHaveBeenCalledTimes(1));
    expect(api.payDiningCheck.mock.calls[0]![0].data).toMatchObject({
      checkId: CHECK1,
      method: "cash",
      amountCents: 584,
      tipCents: 117,
      tenderedCents: 1000,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Check paid and closed."));
  });

  it("split by people charges one share; a retry after a failure reuses the key", async () => {
    setWorkspace(roleDefaults("manager"));
    api.payDiningCheck
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ paymentId: UUID(92), checkStatus: "open", balanceCents: 292 });
    renderPage();
    const sheet = await openCheck1();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Split by people" }));
    expect(within(sheet).getByText("$2.92 per person")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Charge $2.92" }));
    expect(
      await within(sheet).findByText("Something went wrong. Nothing was changed."),
    ).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Charge $2.92" }));
    await waitFor(() => expect(api.payDiningCheck).toHaveBeenCalledTimes(2));
    const [a, b] = api.payDiningCheck.mock.calls.map((c) => c[0].data);
    expect(a).toMatchObject({ amountCents: 292, method: "card", tipCents: 0, tenderedCents: null });
    expect(b.clientKey).toBe(a.clientKey);
  });

  it("refuses more than the balance before calling the server", async () => {
    setWorkspace(roleDefaults("manager"));
    renderPage();
    const sheet = await openCheck1();
    fireEvent.change(within(sheet).getByLabelText("Amount (US$)"), { target: { value: "9" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Charge $9.00" }));
    expect(
      await within(sheet).findByText("The amount is more than what is left to pay."),
    ).toBeInTheDocument();
    expect(api.payDiningCheck).not.toHaveBeenCalled();
  });

  it("without pos.sell no payment can be taken", async () => {
    setWorkspace(["tables.view", "tables.serve"]);
    renderPage();
    const sheet = await openCheck1();
    expect(within(sheet).getByRole("button", { name: "Charge $5.84 and close" })).toBeDisabled();
  });
});

describe("Tables screen: check history", () => {
  beforeEach(() => {
    api.fetchDiningRoom.mockImplementation(async () => seatedRoom());
    api.fetchOperationalMenu.mockResolvedValue(MENU);
  });

  it("an open check shows its timeline with who did each step, no reasons", async () => {
    setWorkspace(roleDefaults("manager"));
    api.fetchCheckHistory.mockResolvedValue([
      { kind: "opened", at: "2026-11-27T12:00:00Z", actor: "Sam" },
      {
        kind: "round_fired",
        at: "2026-11-27T12:05:00Z",
        actor: "Sam",
        roundNo: 1,
        amountCents: 584,
      },
      { kind: "round_voided", at: "2026-11-27T12:06:00Z", actor: "Mia", roundNo: 1 },
      {
        kind: "payment_reversed",
        at: "2026-11-27T12:09:00Z",
        actor: null,
        method: "card",
        amountCents: 300,
        tipCents: 0,
      },
    ]);
    renderPage();
    const menu = await openTable(/^Table T2,/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open check" }));
    const sheet = await screen.findByRole("dialog", { name: "Check · T2" });
    fireEvent.click(within(sheet).getByRole("button", { name: "History" }));
    const dlg = await screen.findByRole("dialog", { name: /^History · T2/ });
    const list = await within(dlg).findByRole("list", { name: "Check events" });
    const lines = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(lines[0]).toContain("Check opened · by Sam");
    expect(lines[1]).toContain("Round 1 sent to the kitchen · $5.84 · by Sam");
    expect(lines[2]).toContain("Round 1 voided, ingredients back to stock · by Mia");
    expect(lines[3]).toContain("Payment of $3.00 (Card) reversed");
    expect(lines[3]).not.toContain(" by ");
    expect(api.fetchCheckHistory.mock.calls[0]![0].data).toEqual({
      orgId: expect.any(String),
      locationId: "store-1",
      checkId: CHECK1,
    });
  });

  it("checks closed today stay reachable from the day summary, each with its history", async () => {
    setWorkspace(roleDefaults("manager"));
    api.fetchDiningDaySummary.mockResolvedValue({
      day: "2026-11-27",
      checksClosed: 1,
      receivedCents: 1700,
      tipsCents: 300,
      byServer: [],
      byMethod: [],
    });
    api.fetchClosedChecksToday.mockResolvedValue([
      {
        id: UUID(77),
        tableLabel: "T5",
        number: 2,
        label: "Ana",
        closedAt: "2026-11-27T13:00:00Z",
        paidCents: 1700,
        tipsCents: 300,
      },
    ]);
    api.fetchCheckHistory.mockResolvedValue([
      { kind: "opened", at: "2026-11-27T12:00:00Z", actor: null },
      { kind: "closed", at: "2026-11-27T13:00:00Z", actor: null },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Closed checks" }));
    const list = await screen.findByRole("dialog", { name: "Checks closed today" });
    expect(await within(list).findByText("T5 · Ana")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "History of T5 · Ana" }));
    const dlg = await screen.findByRole("dialog", { name: "History · T5 · Ana" });
    expect(await within(dlg).findByText("Check paid and closed")).toBeInTheDocument();
    expect(api.fetchCheckHistory.mock.calls[0]![0].data.checkId).toBe(UUID(77));
  });

  it("closed checks of another day: the day goes to the server, and back to today", async () => {
    setWorkspace(roleDefaults("manager"));
    api.fetchDiningDaySummary.mockResolvedValue({
      day: "2026-11-27",
      checksClosed: 1,
      receivedCents: 100,
      tipsCents: 0,
      byServer: [],
      byMethod: [],
    });
    api.fetchClosedChecksToday.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Closed checks" }));
    const dlg = await screen.findByRole("dialog", { name: "Checks closed today" });
    expect(await within(dlg).findByText("No check closed today yet.")).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText("Day"), { target: { value: "2026-11-26" } });
    await waitFor(() =>
      expect(api.fetchClosedChecksToday).toHaveBeenLastCalledWith({
        data: { orgId: expect.any(String), locationId: "store-1", day: "2026-11-26" },
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Checks closed on 2026-11-26" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() =>
      expect(api.fetchClosedChecksToday).toHaveBeenLastCalledWith({
        data: { orgId: expect.any(String), locationId: "store-1" },
      }),
    );
  });
});

describe("day summary", () => {
  it("sums today's recorded tenders and gives each table's server its tips", () => {
    const d = summarizeDay({
      day: "2026-11-27",
      tenders: [
        { amount_cents: 584, tip_cents: 0, status: "recorded", check_id: "c1", method: "cash" },
        { amount_cents: 1700, tip_cents: 306, status: "recorded", check_id: "c2", method: "card" },
        { amount_cents: 999, tip_cents: 500, status: "reversed", check_id: "c2", method: "cash" },
        { amount_cents: 428, tip_cents: 64, status: "recorded", check_id: "c3", method: "card" },
      ],
      checks: [
        { id: "c1", session_id: "s1", status: "closed" },
        { id: "c2", session_id: "s1", status: "closed" },
        { id: "c3", session_id: "s2", status: "open" },
      ],
      sessions: [
        { id: "s1", server_id: "u1" },
        { id: "s2", server_id: "u2" },
      ],
      closedToday: 2,
      profiles: [{ id: "u1", full_name: "Sam" }],
    });
    expect(d.receivedCents).toBe(584 + 1700 + 428);
    expect(d.tipsCents).toBe(306 + 64);
    expect(d.checksClosed).toBe(2);
    expect(d.byServer).toEqual([
      { serverId: "u1", name: "Sam", tipsCents: 306, tenders: 2 },
      { serverId: "u2", name: null, tipsCents: 64, tenders: 1 },
    ]);
    // the drawer: cash first, then card; the reversed cash tender is left out
    expect(d.byMethod).toEqual([
      { method: "cash", amountCents: 584, tipsCents: 0, tenders: 1 },
      { method: "card", amountCents: 1700 + 428, tipsCents: 306 + 64, tenders: 2 },
    ]);
  });

  it("the panel shows what came in by payment method", async () => {
    setWorkspace(roleDefaults("manager"));
    api.fetchDiningDaySummary.mockResolvedValue({
      day: "2026-11-27",
      checksClosed: 2,
      receivedCents: 2712,
      tipsCents: 370,
      byServer: [],
      byMethod: [
        { method: "cash", amountCents: 584, tipsCents: 0, tenders: 1 },
        { method: "card", amountCents: 2128, tipsCents: 370, tenders: 2 },
      ],
    });
    renderPage();
    const list = await screen.findByRole("list", { name: "Received today by payment method" });
    expect(within(list).getByText("Cash: $5.84")).toBeInTheDocument();
    expect(within(list).getByText("Card: $21.28 + $3.70 in tips")).toBeInTheDocument();
  });
});
