import { assertTenantContext } from "./tenant-storage";
import type { POSSession } from "./pos-service";

/**
 * POS sale outbox (wave 0): a sale is written to the browser BEFORE it is sent, under an
 * idempotency key (crypto.randomUUID) that belongs to the ticket. Until the server confirms the
 * sale — or definitively refuses it — the sale stays pending: the ticket is locked, a reload brings
 * it back, and the only ways forward are to verify it by its key or to resend it with the SAME key.
 *
 * Why this never creates a second sale: the database serializes every sale on
 * (organization, client_order_id) with an advisory lock and a unique key (migration 0025). A resend
 * with the same key and the same payload returns the order already recorded; with a different
 * payload it is refused (idempotency_conflict). So whatever happened to a lost response — the sale
 * was recorded, is still on its way, or never arrived — resending the same key yields at most one
 * order. A missing or failed lookup is never taken as proof that the sale does not exist.
 */

export interface PendingSale {
  orgId: string;
  locationId: string;
  /** Idempotency key sent as client_order_id. */
  key: string;
  /** The exact ticket that was sent (same payload on every resend). */
  session: POSSession;
  createdAt: string;
  attempts: number;
  lastAttemptAt: string;
  /** Last known state: "sending" (a request is in flight in some tab) or "unknown". */
  state: "sending" | "unknown";
  lastError?: string | undefined;
}

const PREFIX = "servora.pos_pending_sales.v1.org.";
const keyFor = (orgId: string) => `${PREFIX}${assertTenantContext(orgId)}`;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** A new idempotency key for a ticket. */
export function newSaleKey(): string {
  return `pos-${crypto.randomUUID()}`;
}

function isPending(v: unknown, orgId: string): v is PendingSale {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<PendingSale>;
  return (
    p.orgId === orgId &&
    typeof p.key === "string" &&
    p.key.length > 0 &&
    typeof p.locationId === "string" &&
    !!p.session &&
    Array.isArray(p.session.cart)
  );
}

/** Every pending sale of the organization (records of another organization are dropped). */
export function listPendingSales(orgId: string): PendingSale[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(keyFor(orgId)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((r) => isPending(r, orgId)) : [];
  } catch {
    return [];
  }
}

/**
 * Persists (or updates) a pending sale. Returns false when the browser refused the write (private
 * mode, quota): the caller must then NOT send the sale, because a lost response could not be
 * reconciled after a reload.
 */
export function savePendingSale(p: PendingSale): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const others = listPendingSales(p.orgId).filter((x) => x.key !== p.key);
    s.setItem(keyFor(p.orgId), JSON.stringify([...others, p]));
    return listPendingSales(p.orgId).some((x) => x.key === p.key);
  } catch {
    return false;
  }
}

/** Removes a pending sale once it is resolved (confirmed, or definitively refused). */
export function clearPendingSale(orgId: string, key: string): void {
  const s = storage();
  if (!s) return;
  try {
    const rest = listPendingSales(orgId).filter((x) => x.key !== key);
    if (rest.length) s.setItem(keyFor(orgId), JSON.stringify(rest));
    else s.removeItem(keyFor(orgId));
  } catch {
    /* nothing to do: the entry stays pending and will be verified again */
  }
}

/** The storage key, so other tabs can follow changes (window "storage" event). */
export function pendingStorageKey(orgId: string): string {
  return keyFor(orgId);
}

/** How long one attempt may take before its outcome is treated as unknown. */
export const SALE_TIMEOUT_MS = 20_000;

/**
 * Server refusals that are definitive for this key (no order exists under it):
 * - checked AFTER the sale RPC took the key's lock and found no existing order (stock, tax rate,
 *   products, modifiers, quantities), or
 * - decided only by the payload itself, which is identical on every resend (invalid sale, empty
 *   order, invalid payment, simulation), so the first attempt was refused the same way.
 * Access refusals (store inactive, access or permission removed) are NOT definitive: they are
 * checked before the lookup and may change between attempts, so a first attempt could have been
 * recorded before access was removed. Those, network failures, timeouts, 5xx and unknown codes
 * leave the outcome unknown and the sale pending.
 */
export const ACCESS_REFUSALS = new Set([
  "forbidden",
  "location_forbidden",
  "location_required",
  "permission_denied",
]);
export const DEFINITIVE_REFUSALS = new Set([
  "insufficient_stock",
  "tax_rate_changed",
  "tax_rate_not_configured",
  "invalid_sale",
  "invalid_discount",
  "invalid_quantity",
  "invalid_modifiers",
  "invalid_payment",
  "duplicate_modifier",
  "modifier_not_in_product",
  "modifier_selection_invalid",
  "product_not_in_store",
  "order_empty",
  "simulation_forbidden",
]);

export type AttemptOutcome =
  | { kind: "recorded"; orderId: string; details: boolean }
  | { kind: "refused"; code: string }
  | { kind: "conflict" }
  | { kind: "cancelled" }
  /** The key was closed by an authorized person (0032): no sale can ever be recorded under it. */
  | { kind: "voided" }
  | {
      kind: "unknown";
      reason: "timeout" | "network" | "server" | "access";
      code?: string | undefined;
    };

/** Classifies the result (or thrown error) of one send. */
export function classifyAttempt(
  result: { success: boolean; orderId?: string | undefined; readback?: boolean | undefined } | null,
  error: unknown,
): AttemptOutcome {
  if (result?.success && result.orderId)
    return { kind: "recorded", orderId: result.orderId, details: result.readback !== false };
  // Errors may be DOMExceptions (timeouts, aborts) that are not always `instanceof Error`.
  const thrown =
    error && typeof error === "object" ? (error as { name?: unknown; message?: unknown }) : null;
  const code =
    typeof thrown?.message === "string"
      ? thrown.message.trim()
      : typeof error === "string"
        ? error
        : (result as { error?: string } | null)?.error?.trim();
  const name = typeof thrown?.name === "string" ? thrown.name : "";
  if (name === "TimeoutError" || name === "AbortError" || code === "timeout")
    return { kind: "unknown", reason: "timeout" };
  if (code === "idempotency_conflict") return { kind: "conflict" };
  if (code === "order_cancelled") return { kind: "cancelled" };
  if (code === "sale_key_voided") return { kind: "voided" };
  if (code && DEFINITIVE_REFUSALS.has(code)) return { kind: "refused", code };
  if (code && ACCESS_REFUSALS.has(code)) return { kind: "unknown", reason: "access", code };
  if (!code || /fetch|network|failed to fetch|load failed|econn|socket/i.test(code))
    return { kind: "unknown", reason: "network", code };
  return { kind: "unknown", reason: "server", code };
}
