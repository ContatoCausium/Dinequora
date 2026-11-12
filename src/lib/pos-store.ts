import type { Location } from "@/lib/tenants";

/**
 * Which store the point of sale records sales in.
 *
 * `locations` is the caller's own store list from the workspace: every store of the organization for
 * an owner, only the assigned stores for a manager or staff member (fetchMemberships mirrors
 * can_access_location). A store can sell only when its backend lifecycle is "active", the same rule
 * the database applies on every sale (can_operate_location). Neither its name nor its
 * verification badge matters: a placeholder or inactive store is never picked, and the first store by
 * slug is never chosen just because it comes first.
 *
 * The server stays the authority: create_pos_sale_v2 re-checks access, the store's status and the
 * organization inside the sale transaction, so a store deactivated after this was computed is
 * still refused when the sale is confirmed.
 */
export type PosStoreState =
  /** The register sells in this store. */
  | { kind: "ready"; store: Location }
  /** "All locations" with several stores able to sell: the operator picks one, nothing is guessed. */
  | { kind: "choose"; stores: Location[] }
  /** The selected store cannot sell (inactive or placeholder, or no longer one of the caller's stores). */
  | {
      kind: "unavailable";
      reason: "inactive" | "notAuthorized";
      store?: Location | undefined;
      stores: Location[];
    }
  /** No store of the caller can sell. */
  | { kind: "none"; inactiveCount: number };

export const canSellAt = (store: Location | undefined): store is Location =>
  store?.lifecycle === "active";

export function posEligibleStores(locations: readonly Location[]): Location[] {
  return locations.filter(canSellAt);
}

/** `locationId` is the workspace scope: "all" or one store id. */
export function resolvePosStore(locations: readonly Location[], locationId: string): PosStoreState {
  const eligible = posEligibleStores(locations);
  if (locationId !== "all") {
    const store = locations.find((l) => l.id === locationId);
    if (canSellAt(store)) return { kind: "ready", store };
    return {
      kind: "unavailable",
      reason: store ? "inactive" : "notAuthorized",
      store,
      stores: eligible,
    };
  }
  if (eligible.length === 1) return { kind: "ready", store: eligible[0]! };
  if (eligible.length > 1) return { kind: "choose", stores: eligible };
  return { kind: "none", inactiveCount: locations.length };
}
