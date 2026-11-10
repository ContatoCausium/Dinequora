/**
 * Device cleanup on sign-out.
 *
 * Orders, sales, payments, stock and every other business record live in Supabase and are never
 * touched here. What this removes is temporary, device-only working data that would otherwise
 * stay readable by the next person who signs in on a shared terminal:
 *
 * - held POS tickets (cart + customer name), active and quarantined;
 * - the local history of simulated POS sales (legacy, no longer written);
 * - locally simulated kitchen tickets of demo organizations.
 *
 * Kept on purpose: preferences (theme, language, last organization, inventory view), sign-in
 * settings handled by the auth layer, and quarantined legacy stores (Phase 0 policy: legacy data
 * is never deleted silently).
 */

/** Key prefixes of temporary device data. Each prefix is followed by an organization key. */
export const TEMPORARY_DEVICE_KEY_PREFIXES = [
  "servora.pos.suspended.",
  "servora.quarantine.pos.suspended.",
  "servora.pos.history.",
  "servora.orders.",
] as const;

type KeyStorage = Pick<Storage, "length" | "key" | "getItem" | "removeItem">;

function browserStorage(): KeyStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function temporaryKeys(storage: KeyStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && TEMPORARY_DEVICE_KEY_PREFIXES.some((p) => key.startsWith(p))) keys.push(key);
  }
  return keys;
}

/** Number of held POS tickets on this device (all organizations), for the sign-out warning. */
export function countHeldTicketsOnDevice(storage: KeyStorage | null = browserStorage()): number {
  if (!storage) return 0;
  let count = 0;
  for (const key of temporaryKeys(storage)) {
    if (!key.startsWith("servora.pos.suspended.")) continue;
    try {
      const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
      count += Array.isArray(parsed) ? parsed.length : 1;
    } catch {
      count += 1;
    }
  }
  return count;
}

/** Removes temporary device data. Safe to call more than once. Returns the keys removed. */
export function clearTemporaryDeviceData(storage: KeyStorage | null = browserStorage()): string[] {
  if (!storage) return [];
  const keys = temporaryKeys(storage);
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // A storage failure must never block sign-out.
    }
  }
  return keys;
}
