/**
 * Public contact addresses of the platform, read from configuration — never hard-coded.
 *
 *   VITE_SUPPORT_EMAIL   e.g. the Dinequora support mailbox once its domain and inbox are confirmed.
 *
 * Unset (today) means "no support address": callers must hide the contact instead of inventing
 * one. The demo support tickets in support-service.ts keep their fictional addresses.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function supportEmail(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): string | null {
  const v = env["VITE_SUPPORT_EMAIL"]?.trim();
  return v && EMAIL.test(v) ? v : null;
}
