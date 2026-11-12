import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { roleDefaults, type Permission } from "@/lib/permissions";
import type { OrgRole } from "@/lib/access-rules";

/**
 * Menu & Products screen with the workspace and the menu server functions mocked: what each role
 * is offered, how refusals from the database are explained, and the category lifecycle (create,
 * edit, archive, reactivate). The RPCs themselves are covered by scripts/security (0026-0028).
 */
const api = vi.hoisted(() => ({
  fetchOperationalMenu: vi.fn(),
  saveOperationalMenu: vi.fn(),
  archiveOperationalMenu: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const workspace = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/operational.functions", () => api);
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/app/workspace-context", () => ({
  useWorkspace: () => workspace.current,
}));

import { MenuPage } from "@/components/menu/menu-page";

type Item = {
  id: string;
  orgId: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  prepTimeMinutes: number;
  active: boolean;
  locationIds: string[];
  otherStoreCount?: number;
  notes?: string;
  modifierGroups: [];
  createdAt: string;
};
const item = (over: Partial<Item>): Item => ({
  id: "item-1",
  orgId: "org-1",
  name: "Classic Burger",
  description: "",
  category: "burgers",
  priceCents: 1250,
  prepTimeMinutes: 10,
  active: true,
  locationIds: [],
  modifierGroups: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

type Menu = {
  categories: { id: string; name: string; description?: string }[];
  archivedCategories: { id: string; name: string; description?: string; productCount: number }[];
  items: Item[];
};
const baseMenu = (): Menu => ({
  categories: [
    { id: "burgers", name: "Burgers" },
    { id: "sides", name: "Sides" },
  ],
  archivedCategories: [{ id: "desserts", name: "Desserts", productCount: 1 }],
  items: [
    item({ id: "item-1", name: "Classic Burger", category: "burgers", locationIds: [] }),
    item({ id: "item-2", name: "Store Fries", category: "sides", locationIds: ["downtown"] }),
    item({ id: "item-3", name: "Old Brownie", category: "", active: false, locationIds: [] }),
  ],
});

type Lifecycle = "active" | "inactive" | "placeholder";
function setWorkspace(
  role: OrgRole,
  stores: (string | [string, Lifecycle])[] = ["downtown", "riverside"],
  orgId = "org-1",
) {
  const perms = new Set<Permission>(roleDefaults(role));
  workspace.current = {
    role,
    can: (p: Permission) => perms.has(p),
    canAny: (ps: Permission[]) => ps.some((p) => perms.has(p)),
    org: {
      id: orgId,
      name: orgId === "org-1" ? "Test Kitchen" : "Other Kitchen",
      fictional: false,
      locations: stores.map((s) => {
        const [id, lifecycle] = typeof s === "string" ? [s, "active" as const] : s;
        return { id, name: id, status: "verified", timezone: "UTC", lifecycle };
      }),
    },
    locationId: "all",
  };
}

const businessError = (code: string) => new Error(code);

async function renderMenu(menu: Menu = baseMenu()) {
  api.fetchOperationalMenu.mockResolvedValue(menu);
  render(<MenuPage />);
  await screen.findByText("Classic Burger");
}
const openCategories = () =>
  fireEvent.click(screen.getByRole("button", { name: "Manage Categories" }));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  api.fetchOperationalMenu.mockReset();
  api.saveOperationalMenu.mockReset().mockResolvedValue({ ok: true });
  api.archiveOperationalMenu.mockReset().mockResolvedValue({ ok: true });
  toast.success.mockReset();
  toast.error.mockReset();
  setWorkspace("owner");
});
afterEach(() => cleanup());

describe("loading and error states", () => {
  it("shows a loading state, never the empty state, while the menu loads", async () => {
    let resolve!: (m: Menu) => void;
    api.fetchOperationalMenu.mockReturnValue(new Promise<Menu>((r) => (resolve = r)));
    render(<MenuPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the menu…");
    expect(screen.queryByText("Your menu is empty")).toBeNull();
    resolve(baseMenu());
    expect(await screen.findByText("Classic Burger")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a load error with a retry that reloads", async () => {
    api.fetchOperationalMenu.mockRejectedValueOnce(new Error("menu_read_failed"));
    render(<MenuPage />);
    expect(await screen.findByText("We couldn't load the menu")).toBeInTheDocument();
    expect(screen.queryByText("menu_read_failed")).toBeNull();
    api.fetchOperationalMenu.mockResolvedValue(baseMenu());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Classic Burger")).toBeInTheDocument();
  });

  it("guides an owner without categories to create one first", async () => {
    api.fetchOperationalMenu.mockResolvedValue({
      categories: [],
      archivedCategories: [],
      items: [],
    });
    render(<MenuPage />);
    expect(await screen.findByText("Your menu is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Product" })).toBeDisabled();
  });

  it("distinguishes 'no match for the filters' from an empty menu", async () => {
    await renderMenu();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the menu" }), {
      target: { value: "pizza" },
    });
    expect(screen.getByText("No products match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Classic Burger")).toBeInTheDocument();
  });

  it("filters by availability", async () => {
    await renderMenu();
    fireEvent.click(screen.getByRole("radio", { name: "Unavailable" }));
    expect(screen.queryByText("Classic Burger")).toBeNull();
    expect(screen.getByText("Old Brownie")).toBeInTheDocument();
  });
});

describe("owner: category lifecycle", () => {
  it("creates a category through the menu save RPC and refreshes", async () => {
    await renderMenu();
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "New Category" }));
    fireEvent.change(screen.getByLabelText(/Category Name/), {
      target: { value: "Smash Burgers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Category" }));
    await waitFor(() =>
      expect(api.saveOperationalMenu).toHaveBeenCalledWith({
        data: {
          kind: "category",
          orgId: "org-1",
          category: { id: "smash-burgers", name: "Smash Burgers" },
        },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Category created");
    expect(api.fetchOperationalMenu).toHaveBeenCalledTimes(2);
  });

  it("refuses a new category that would overwrite an active one or revive an archived one", async () => {
    await renderMenu();
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "New Category" }));
    const name = screen.getByLabelText(/Category Name/);
    fireEvent.change(name, { target: { value: "burgers" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Category" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A category named “Burgers” already exists.",
    );
    fireEvent.change(name, { target: { value: "Desserts" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Category" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reactivate it instead");
    expect(api.saveOperationalMenu).not.toHaveBeenCalled();
  });

  it("requires a category name", async () => {
    await renderMenu();
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "New Category" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Category" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a category name.");
    expect(api.saveOperationalMenu).not.toHaveBeenCalled();
  });

  it("edits a category keeping its id", async () => {
    await renderMenu();
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "Edit Sides" }));
    const name = screen.getByLabelText(/Category Name/);
    expect(name).toHaveValue("Sides");
    fireEvent.change(name, { target: { value: "Sides & Snacks" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Crispy" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(api.saveOperationalMenu).toHaveBeenCalledWith({
        data: {
          kind: "category",
          orgId: "org-1",
          category: { id: "sides", name: "Sides & Snacks", description: "Crispy" },
        },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Category updated");
  });

  it("does not offer archiving a category with active products, and explains why", async () => {
    await renderMenu();
    openCategories();
    const row = screen.getByRole("button", { name: "Archive Burgers" }).closest("li")!;
    expect(within(row).getByRole("button", { name: "Archive Burgers" })).toBeDisabled();
    expect(within(row).getByText(/1 available product uses this category/)).toBeInTheDocument();
    expect(within(row).getByText(/1 product/)).toBeInTheDocument();
  });

  it("archives a category without active products after confirmation, via the archive RPC", async () => {
    const menu = baseMenu();
    menu.items[1] = { ...menu.items[1]!, active: false };
    await renderMenu(menu);
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "Archive Sides" }));
    expect(api.archiveOperationalMenu).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archive Category" }));
    await waitFor(() =>
      expect(api.archiveOperationalMenu).toHaveBeenCalledWith({
        data: { orgId: "org-1", kind: "category", id: "sides" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Category archived");
  });

  it("explains category_in_use when the database refuses (product activated meanwhile)", async () => {
    const menu = baseMenu();
    menu.items[1] = { ...menu.items[1]!, active: false };
    await renderMenu(menu);
    api.archiveOperationalMenu.mockRejectedValueOnce(businessError("category_in_use"));
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "Archive Sides" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive Category" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This category still has active products. Mark them unavailable or move them to another category before archiving it.",
      ),
    );
    // The screen is refreshed after a refusal too.
    await waitFor(() => expect(api.fetchOperationalMenu).toHaveBeenCalledTimes(2));
  });

  it("lists archived categories and reactivates one by saving it with the same id", async () => {
    await renderMenu();
    openCategories();
    const archived = screen.getByRole("region", { name: "Archived" });
    expect(within(archived).getByText("Desserts")).toBeInTheDocument();
    expect(within(archived).getByText("1 product")).toBeInTheDocument();
    fireEvent.click(within(archived).getByRole("button", { name: "Reactivate Desserts" }));
    await waitFor(() =>
      expect(api.saveOperationalMenu).toHaveBeenCalledWith({
        data: { kind: "category", orgId: "org-1", category: { id: "desserts", name: "Desserts" } },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Category reactivated");
  });
});

describe("products and categories", () => {
  it("flags a product of an archived category and blocks making it available", async () => {
    await renderMenu();
    const card = screen.getByText("Old Brownie").closest("li")!;
    expect(within(card).getByText("Category archived")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Mark available" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Duplicate Old Brownie" })).toBeDisabled();
  });

  it("requires an active category before saving such a product", async () => {
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Edit Old Brownie" }));
    expect(screen.getByText(/The category of this product was archived/)).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose an active category for this product.",
    );
    expect(api.saveOperationalMenu).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "sides" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    await waitFor(() => expect(api.saveOperationalMenu).toHaveBeenCalledTimes(1));
    expect(api.saveOperationalMenu.mock.calls[0]![0].data.item).toMatchObject({
      id: "item-3",
      category: "sides",
    });
    expect(toast.success).toHaveBeenCalledWith("Product updated");
  });

  it("explains category_required from the database and keeps the form open", async () => {
    await renderMenu();
    api.saveOperationalMenu.mockRejectedValueOnce(businessError("category_required"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Classic Burger" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This product needs an active category."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks for confirmation before removing a product", async () => {
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Remove Classic Burger from the menu" }));
    expect(api.archiveOperationalMenu).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove from menu" }),
    );
    await waitFor(() =>
      expect(api.archiveOperationalMenu).toHaveBeenCalledWith({
        data: { orgId: "org-1", kind: "product", id: "item-1" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Product removed from the menu");
  });

  it("reports a successful save as success even if the refresh after it fails", async () => {
    await renderMenu();
    api.fetchOperationalMenu.mockRejectedValueOnce(new Error("menu_read_failed"));
    fireEvent.click(
      within(screen.getByText("Classic Burger").closest("li")!).getByRole("button", {
        name: "Mark unavailable",
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Product marked unavailable"));
    await waitFor(() => expect(api.fetchOperationalMenu).toHaveBeenCalledTimes(2));
    expect(toast.error).not.toHaveBeenCalled();
    // The screen does not pretend to be up to date: it says so and offers to reload.
    const notice = await screen.findByText(/could not be refreshed/);
    expect(notice).toBeInTheDocument();
    const updated = baseMenu();
    updated.items[0] = { ...updated.items[0]!, active: false };
    api.fetchOperationalMenu.mockResolvedValue(updated);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.queryByText(/could not be refreshed/)).toBeNull());
    expect(
      within(screen.getByText("Classic Burger").closest("li")!).getByText("Unavailable"),
    ).toBeInTheDocument();
  });

  it("shows the generic message, never technical text, for unexpected failures", async () => {
    await renderMenu();
    api.saveOperationalMenu.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "menu_products_pkey"'),
    );
    fireEvent.click(
      within(screen.getByText("Classic Burger").closest("li")!).getByRole("button", {
        name: "Mark unavailable",
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't complete this action. Please try again.",
      ),
    );
  });
});

describe("roles", () => {
  it("manager: no category management; products limited to their stores", async () => {
    setWorkspace("manager", ["downtown"]);
    await renderMenu();
    expect(screen.queryByRole("button", { name: "Manage Categories" })).toBeNull();
    expect(screen.getByText(/Categories are managed by the account owner/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Product" })).toBeInTheDocument();
    // Sold in every store: owner-only in the database.
    const all = screen.getByText("Classic Burger").closest("li")!;
    expect(within(all).queryByRole("button", { name: "Edit Classic Burger" })).toBeNull();
    expect(
      within(all).getByText("Sold in every store: only the account owner can change it."),
    ).toBeInTheDocument();
    // Sold only in the manager's store.
    const own = screen.getByText("Store Fries").closest("li")!;
    expect(within(own).getByRole("button", { name: "Edit Store Fries" })).toBeInTheDocument();
  });

  it("manager: a refusal from the database is still explained (backend stays the authority)", async () => {
    setWorkspace("manager", ["downtown"]);
    await renderMenu();
    api.saveOperationalMenu.mockRejectedValueOnce(businessError("forbidden"));
    fireEvent.click(
      within(screen.getByText("Store Fries").closest("li")!).getByRole("button", {
        name: "Mark unavailable",
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("You don't have permission to perform this action."),
    );
  });

  it("staff: read-only, no write action anywhere", async () => {
    setWorkspace("staff", ["downtown"]);
    await renderMenu();
    expect(screen.getByText(/View only/)).toBeInTheDocument();
    for (const name of ["Manage Categories", "New Product", "Mark unavailable", "Edit Store Fries"])
      expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("translates permission_denied in Portuguese", async () => {
    await i18n.changeLanguage("pt-BR");
    setWorkspace("manager", ["downtown"]);
    api.fetchOperationalMenu.mockResolvedValue(baseMenu());
    render(<MenuPage />);
    await screen.findByText("Store Fries");
    api.saveOperationalMenu.mockRejectedValueOnce(businessError("permission_denied"));
    fireEvent.click(
      within(screen.getByText("Store Fries").closest("li")!).getByRole("button", {
        name: "Marcar indisponível",
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Seu perfil não permite executar esta ação."),
    );
  });
});

describe("review fixes", () => {
  const saved = (n = 0) => api.saveOperationalMenu.mock.calls[n]![0].data;

  it("only the Menu screen asks for archived categories", async () => {
    await renderMenu();
    expect(api.fetchOperationalMenu).toHaveBeenCalledWith({
      data: { orgId: "org-1", includeArchived: true },
    });
  });

  it("a retry after an uncertain failure saves the same new product, not a second one", async () => {
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "New Product" }));
    fireEvent.change(screen.getByLabelText("Item Name"), { target: { value: "Shake" } });
    api.saveOperationalMenu.mockRejectedValueOnce(new Error("TypeError: Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    await waitFor(() => expect(api.saveOperationalMenu).toHaveBeenCalledTimes(2));
    expect(saved(1).item.id).toBe(saved(0).item.id);
    expect(saved(0).item.id).toMatch(/^item-/);
    expect(saved(0).item.locationIds).toEqual([]); // owner: every store
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Product created"));
  });

  it("manager: a new product is sold in their ACTIVE stores only", async () => {
    setWorkspace("manager", ["downtown", ["riverside", "placeholder"]]);
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "New Product" }));
    fireEvent.change(screen.getByLabelText("Item Name"), { target: { value: "Shake" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    await waitFor(() => expect(api.saveOperationalMenu).toHaveBeenCalledTimes(1));
    expect(saved().item.locationIds).toEqual(["downtown"]);
  });

  it("manager without any active store is not offered New Product", async () => {
    setWorkspace("manager", [["downtown", "inactive"]]);
    await renderMenu();
    expect(screen.queryByRole("button", { name: "New Product" })).toBeNull();
  });

  it("keeps the kitchen notes when a product is edited", async () => {
    const menu = baseMenu();
    menu.items[0] = { ...menu.items[0]!, notes: "No onions" };
    await renderMenu(menu);
    fireEvent.click(screen.getByRole("button", { name: "Edit Classic Burger" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    await waitFor(() => expect(api.saveOperationalMenu).toHaveBeenCalledTimes(1));
    expect(saved().item.notes).toBe("No onions");
  });

  it("Cancel is disabled while a save is in progress", async () => {
    await renderMenu();
    let finish!: () => void;
    api.saveOperationalMenu.mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
    fireEvent.click(screen.getByRole("button", { name: "Edit Classic Burger" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a description-only edit of a category is not a collision with itself", async () => {
    await renderMenu();
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "Edit Sides" }));
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Crispy" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.saveOperationalMenu).toHaveBeenCalledTimes(1));
    expect(saved().category).toEqual({ id: "sides", name: "Sides", description: "Crispy" });
  });

  it("a rename cannot take another category's name, even with other accents or punctuation", async () => {
    await renderMenu();
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "Edit Sides" }));
    fireEvent.change(screen.getByLabelText(/Category Name/), { target: { value: "búrgers." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("“Burgers” already exists");
    expect(api.saveOperationalMenu).not.toHaveBeenCalled();
  });

  it("a new category with the old name of a renamed one gets a new id (no overwrite)", async () => {
    const menu = baseMenu();
    menu.categories.push({ id: "drinks", name: "Beverages" });
    await renderMenu(menu);
    openCategories();
    fireEvent.click(screen.getByRole("button", { name: "New Category" }));
    fireEvent.change(screen.getByLabelText(/Category Name/), { target: { value: "Drinks" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Category" }));
    await waitFor(() => expect(api.saveOperationalMenu).toHaveBeenCalledTimes(1));
    expect(saved().category).toEqual({ id: "drinks-2", name: "Drinks" });
  });

  it("manager: a product also sold in stores they cannot see is not offered, and counts every store", async () => {
    setWorkspace("manager", ["downtown"]);
    const menu = baseMenu();
    menu.items[1] = { ...menu.items[1]!, otherStoreCount: 1 };
    await renderMenu(menu);
    const card = screen.getByText("Store Fries").closest("li")!;
    expect(within(card).queryByRole("button", { name: "Edit Store Fries" })).toBeNull();
    expect(within(card).queryByRole("button", { name: /Duplicate/ })).toBeNull();
    expect(within(card).getByText("Sold in stores you don't manage")).toBeInTheDocument();
    expect(within(card).getByText("2 stores")).toBeInTheDocument();
  });

  it("owner: a product listed in a store that is not active is explained, not offered", async () => {
    setWorkspace("owner", ["downtown", ["pop-up", "placeholder"]]);
    const menu = baseMenu();
    menu.items[1] = { ...menu.items[1]!, locationIds: ["pop-up"] };
    await renderMenu(menu);
    const card = screen.getByText("Store Fries").closest("li")!;
    expect(within(card).queryByRole("button", { name: "Edit Store Fries" })).toBeNull();
    expect(within(card).getByText(/Sold in a store that is not active/)).toBeInTheDocument();
  });

  it("switching organization: a late response of the previous organization is ignored", async () => {
    api.fetchOperationalMenu.mockResolvedValue(baseMenu());
    const view = render(<MenuPage />);
    await screen.findByText("Classic Burger");
    const other: Menu = {
      categories: [{ id: "pizza", name: "Pizza" }],
      archivedCategories: [],
      items: [item({ id: "p-1", name: "Margherita", category: "pizza" })],
    };
    let lateOrg1: ((m: Menu) => void) | undefined;
    api.fetchOperationalMenu.mockImplementation(({ data }: { data: { orgId: string } }) =>
      data.orgId === "org-1" ? new Promise<Menu>((r) => (lateOrg1 = r)) : Promise.resolve(other),
    );
    // A write in org-1 whose refresh is still in flight when the member switches organization
    // (same mounted screen, as the organization switcher does).
    fireEvent.click(
      within(screen.getByText("Classic Burger").closest("li")!).getByRole("button", {
        name: "Mark unavailable",
      }),
    );
    await waitFor(() => expect(lateOrg1).toBeDefined());
    setWorkspace("owner", undefined, "org-2");
    view.rerender(<MenuPage />);
    expect(await screen.findByText("Margherita")).toBeInTheDocument();
    lateOrg1!(baseMenu());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Classic Burger")).toBeNull();
    expect(screen.getByText("Margherita")).toBeInTheDocument();
  });
});
