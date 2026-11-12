/**
 * What the Menu & Products screen offers to the signed-in member. UI hints only, mirroring the
 * database rules (save_operational_menu 0028 / archive_operational_menu 0026, which re-check
 * everything and remain the authority):
 * - categories (create, edit, archive, reactivate) are owner-only (is_org_owner);
 * - products need menu.create (new, duplicate), menu.edit (edit, availability) or menu.delete
 *   (remove);
 * - every store a product is sold in must pass can_operate_location for the member, owners
 *   included: an assigned store that is ACTIVE (placeholder or inactive stores are refused);
 * - a non-owner can neither touch a product sold in every store (empty store list) nor one also
 *   sold in stores they cannot see (otherStoreCount > 0).
 */
import type { OrgRole } from "@/lib/access-rules";
import type { Permission } from "@/lib/permissions";

export type MenuStore = {
  /** Store id as used by the screen (slug). */
  id: string;
  /** Database status; absent only for non-database (static) data, treated as active. */
  lifecycle?: "active" | "inactive" | "placeholder" | undefined;
};

export type MenuAbilityInput = {
  role: OrgRole;
  can: (permission: Permission) => boolean;
  /** Stores the member can see: every store for owners, assigned stores otherwise. */
  stores: readonly MenuStore[];
};

export type ProductScope = { locationIds: readonly string[]; otherStoreCount?: number | undefined };

/** Why a product can (ok) or cannot be changed by this member. */
export type ProductAccess = "ok" | "allStores" | "otherStores" | "inactiveStore";

export type MenuAbilities = {
  /** Create, edit, archive and reactivate categories. */
  manageCategories: boolean;
  createProducts: boolean;
  editProducts: boolean;
  archiveProducts: boolean;
  /** Any write at all (otherwise the screen is read-only). */
  anyWrite: boolean;
  productAccess: (product: ProductScope) => ProductAccess;
  /**
   * Stores of a NEW product: every store for an owner (empty list); for others, the selected store
   * or all their active stores. null when the member has no active store to sell in.
   */
  newProductStores: (selectedStore: string) => string[] | null;
};

export function menuAbilities({ role, can, stores }: MenuAbilityInput): MenuAbilities {
  const owner = role === "owner";
  const visible = new Set(stores.map((s) => s.id));
  const operable = stores.filter((s) => (s.lifecycle ?? "active") === "active").map((s) => s.id);
  const operableSet = new Set(operable);
  const createProducts = can("menu.create") && (owner || operable.length > 0);
  const editProducts = can("menu.edit");
  const archiveProducts = can("menu.delete");
  return {
    manageCategories: owner,
    createProducts,
    editProducts,
    archiveProducts,
    anyWrite: owner || createProducts || editProducts || archiveProducts,
    productAccess: (product) => {
      if ((product.otherStoreCount ?? 0) > 0) return "otherStores";
      if (product.locationIds.some((id) => !visible.has(id))) return "otherStores";
      if (product.locationIds.some((id) => !operableSet.has(id))) return "inactiveStore";
      if (product.locationIds.length === 0 && !owner) return "allStores";
      return "ok";
    },
    newProductStores: (selectedStore) => {
      if (owner) return [];
      if (selectedStore !== "all") return operableSet.has(selectedStore) ? [selectedStore] : null;
      return operable.length > 0 ? [...operable] : null;
    },
  };
}
