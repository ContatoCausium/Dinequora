/**
 * Build-time switch for the server code that holds privileged capabilities (Stripe secret key
 * reader, service-role client for the Stripe webhook).
 *
 * The client-preview build must not contain that code at all (scripts/preview/verify-bundle.mjs
 * refuses it), so call sites write `STRIPE_IN_BUILD ? await import(...) : fallback`: Vite inlines
 * the profile as a string literal and the bundler drops the branch and its dynamic import.
 */
export const STRIPE_IN_BUILD: boolean =
  import.meta.env.VITE_DEPLOYMENT_PROFILE !== "client-preview";

/** Stripe webhook endpoint, handled in src/server.ts (kept here so the route check imports nothing else). */
export const STRIPE_WEBHOOK_PATH = "/api/public/stripe-webhook";
