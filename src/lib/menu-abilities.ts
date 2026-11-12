/**
 * What the Menu & Products screen offers to the signed-in member. UI hints only, mirroring the
 * database rules (the RPCs and RLS remain the authority and re-check everything):
 * - categories (create, edit, archive, reactivate) are owner-only: save_operational_menu and
 *   archive_operational_menu both require is_org_owner for the category kind;
 * - products need menu.create (new), menu.edit (edit, availability) or menu.delete (archive), and a
 *   non-owner can only touch products sold exclusively in stores they can operate (a product sold
 *   in every store, i.e. with no store list, is owner-only);
 * - duplicating creates a product, so it needs menu.create and the same store scope.
 */
import type { OrgRole } from "@/lib/access-rules";
import type { Permission } from "@/lib/permissions";

export type MenuAbilityInput = {
  role: OrgRole;
  can: (permission: Permission) => boolean;
  /** Store ids (slugs) the member can operate: every store for owners, assigned ones otherwise. */
  storeIds: readonly string[];
};

export type MenuAbilities = {
  /** Create, edit, archive and reactivate categories. */
  manageCategories: boolean;
  createProducts: boolean;
  editProducts: boolean;
  archiveProducts: boolean;
  /** Any write at all (otherwise the screen is read-only). */
  anyWrite: boolean;
  /** Whether this member may change the given product (store scope). */
  canTouchProduct: (product: { locationIds: readonly string[] }) => boolean;
};

export function menuAbilities({ role, can, storeIds }: MenuAbilityInput): MenuAbilities {
  const owner = role === "owner";
  const stores = new Set(storeIds);
  const createProducts = can("menu.create");
  const editProducts = can("menu.edit");
  const archiveProducts = can("menu.delete");
  return {
    manageCategories: owner,
    createProducts,
    editProducts,
    archiveProducts,
    anyWrite: owner || createProducts || editProducts || archiveProducts,
    canTouchProduct: (product) =>
      owner ||
      (product.locationIds.length > 0 && product.locationIds.every((id) => stores.has(id))),
  };
}
