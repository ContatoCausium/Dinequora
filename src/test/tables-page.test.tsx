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

  it("the route is open to any of the three tables permissions", () => {
    expect(requiredFor("/tables")).toEqual(["tables.view", "tables.status", "tables.manage"]);
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
