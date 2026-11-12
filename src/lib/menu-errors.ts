/**
 * Menu & Products: business errors returned by the menu RPCs (save_operational_menu,
 * archive_operational_menu, migrations 0018/0026-0028) and by the server functions, mapped to
 * translated messages. The user never sees a raw code, SQL text, a function name or a database
 * detail; the original code is kept for logs and observability.
 */
import { captureError, isExpectedBusinessError, logEvent } from "@/lib/observability";

/** Codes the menu flows can return, each with its own message key under `menu:errors`. */
export const MENU_ERROR_CODES = [
  "category_in_use",
  "category_required",
  // 0029 category intents (create / update / reactivate)
  "category_exists",
  "category_archived",
  "category_not_archived",
  "forbidden",
  "permission_denied",
  "location_forbidden",
  "not_found",
  "invalid_menu",
  "invalid_modifiers",
  "duplicate_modifier_group",
  "duplicate_modifier_option",
  "org_suspended",
  "subscription_inactive",
] as const;
export type MenuErrorCode = (typeof MENU_ERROR_CODES)[number];

const KNOWN = new Set<string>(MENU_ERROR_CODES);

/** The code carried by an error thrown by a server function (its message), or null. */
export function menuErrorCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = message.trim();
  return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : null;
}

/** Translation key (namespace `menu`) for an error: a known code, or the generic message. */
export function menuErrorKey(error: unknown): `errors.${MenuErrorCode | "unknown"}` {
  const code = menuErrorCode(error);
  return code && KNOWN.has(code)
    ? (`errors.${code}` as `errors.${MenuErrorCode}`)
    : "errors.unknown";
}

/**
 * Records a failed menu action with its original code: expected business refusals as a warning
 * event, anything else as a captured error (with stack, for diagnosis).
 */
export function reportMenuError(action: string, error: unknown): void {
  const code = menuErrorCode(error);
  if (isExpectedBusinessError(error) || (code !== null && KNOWN.has(code))) {
    logEvent("warn", "menu.action_refused", { action, code });
  } else {
    captureError(error, { event: "menu.action_failed", action });
  }
}
