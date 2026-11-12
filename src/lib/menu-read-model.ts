/**
 * Read model of the operational menu (fetchOperationalMenu), from rows the caller can read under
 * RLS. Pure, so the mapping is tested without a database.
 */
import type { Database } from "@/integrations/supabase/types";
import { modifierGroupsSchema } from "./operational-contracts";

type Tables = Database["public"]["Tables"];
type CategoryRow = Pick<
  Tables["menu_categories"]["Row"],
  "id" | "client_id" | "name" | "description"
>;
type ProductRow = Tables["menu_products"]["Row"];

export function toMenuReadModel(input: {
  orgSlug: string;
  /** Stores the caller can read (owners: every store; others: assigned stores only). */
  locations: readonly { id: string; slug: string }[];
  categories: readonly CategoryRow[];
  archivedCategories: readonly CategoryRow[];
  products: readonly ProductRow[];
}) {
  const categoryIds = new Map(input.categories.map((c) => [c.id, c.client_id]));
  const slugs = new Map(input.locations.map((l) => [l.id, l.slug]));
  const perCategory = new Map<string, number>();
  for (const p of input.products)
    if (p.category_id) perCategory.set(p.category_id, (perCategory.get(p.category_id) ?? 0) + 1);
  return {
    // Active categories only (used as is by the POS and the inventory screens).
    categories: input.categories.map((c) => ({
      id: c.client_id,
      name: c.name,
      description: c.description,
    })),
    // Archived categories (Menu screen only), with how many products still point at each one
    // (none of them can be active: migrations 0026-0028).
    archivedCategories: input.archivedCategories.map((c) => ({
      id: c.client_id,
      name: c.name,
      description: c.description,
      productCount: perCategory.get(c.id) ?? 0,
    })),
    items: input.products.map((p) => {
      const locationIds = p.location_ids.flatMap((id) => {
        const slug = slugs.get(id);
        return slug ? [slug] : [];
      });
      return {
        id: p.client_id,
        orgId: input.orgSlug,
        name: p.name,
        description: p.description,
        category: categoryIds.get(p.category_id ?? "") ?? "",
        priceCents: p.price_cents,
        prepTimeMinutes: p.prep_time_minutes,
        ...(p.image_url ? { imageUrl: p.image_url } : {}),
        ...(p.notes ? { notes: p.notes } : {}),
        active: p.active,
        locationIds,
        // Stores of this product the caller cannot see (not assigned to them). The database refuses
        // a non-owner who changes such a product, so the Menu screen does not offer it.
        otherStoreCount: p.location_ids.length - locationIds.length,
        modifierGroups: modifierGroupsSchema.parse(p.modifier_groups),
        createdAt: p.created_at,
      };
    }),
  };
}
