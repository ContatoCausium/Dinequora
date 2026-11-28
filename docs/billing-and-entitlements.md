# Plans, entitlements and Stripe Billing

## Entitlements (live now)

- Plan definitions live only in `billing_plans`: `default_store_limit` (paid), `trial_store_limit` (trial), `trial_days`, `entitlements` (modules, employees).
- An organization's plan is `subscriptions.plan_id`. `organizations.plan` / `organizations.store_limit` are derived caches kept in sync by the `subscription_sync_entitlements` trigger — never written by app code.
- `effective_store_limit(org)` = `organizations.store_limit_override` (operator exception, audited) else the plan's trial or paid allowance.
- `create_location` and `set_location_status` (reactivation) check `active_store_count < effective_store_limit` under a row lock. Inactive stores do not count.
- Downgrade below current usage keeps existing stores running but blocks new stores and reactivations until the count fits.
- Operational = org not suspended AND subscription is: trialing before `trial_ends_at`, active, past_due, incomplete, or grace before `grace_ends_at`. Expired trial, expired grace, unpaid and canceled block every write RPC (`subscription_inactive`).
- Plans/status change only through `admin_set_subscription` / `admin_update_organization` (platform admin, reason required, audited) or, later, the verified Stripe webhook.

## Privileged tables

| Table                   | Users                          | Platform admins     | Service role                         |
| ----------------------- | ------------------------------ | ------------------- | ------------------------------------ |
| `subscriptions`         | owner reads own org            | via admin RPCs only | full                                 |
| `billing_events`        | owner reads own org; no writes | no direct read      | full (webhook)                       |
| `billing_plans`         | read active plans              | —                   | full                                 |
| `stripe_webhook_events` | none                           | none                | full                                 |
| `platform_bootstrap`    | none                           | none                | via `bootstrap_first_platform_admin` |
| `audit_logs`            | owners/managers read own org   | read all            | insert via `write_audit` only        |

Verified by `scripts/security/billing_entitlements.sql` (security suite, step 3, on a disposable database): plan allowances read from `billing_plans`, store limits, subscription states that block writes, suspended organizations, owner-only billing, and every refused write to subscriptions, plans, entitlements, payment history, webhook ids, Stripe events, admin plan RPCs and bootstrap. It replaces the retired, unguarded `scripts/security/regression_locations_team.py`.

## Stripe Billing (implemented; test mode first, live only with explicit approval)

Code: `src/lib/billing.functions.ts` (checkout, portal, mode), `src/lib/stripe/stripe-api.ts`
(REST client, signature check), `src/lib/stripe/billing-webhook.ts` (event mapping, endpoint),
`src/server.ts` (route), `scripts/stripe/setup-catalog.mjs` (catalog). Tests:
`src/test/stripe-billing.test.ts`.

- **Prices**: one Stripe product per self-serve plan (Starter, Growth) with a monthly price and a
  one-time implementation price, found by lookup key `dinequora_<plan>_monthly` /
  `dinequora_<plan>_implementation`. Amounts equal `billing_plans` (0047); checkout refuses when
  Stripe's amount differs from the plan's, so the app never charges a price it does not show.
  Enterprise (contract, implementation "from") has no online checkout.
- **Checkout**: owner-only server function (`is_org_owner` as the signed-in user). Mode
  `subscription`: monthly price + implementation on the first invoice. `client_reference_id`,
  `metadata` and `subscription_data.metadata` carry `org_id` and `plan_id`. The browser is only
  redirected and never reports success; a second checkout is refused while a Stripe subscription
  is live (changes go through the portal).
- **Portal**: owner-only; card, invoices, cancel at period end (default portal configuration made by
  the setup script).
- **Webhook**: `POST /api/public/stripe-webhook`, handled in `src/server.ts` before the router. Verifies
  `Stripe-Signature` (v1, 5-minute tolerance, rotation-safe) on the raw body, maps the event and calls
  `billing_apply_stripe_event` with the service role. 400 bad signature, 200 ignored/duplicate, 500
  when the database refuses (Stripe retries; the event id makes retries no-ops). Events:
  `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`
  (→ active, payment recorded), `invoice.payment_failed` (→ past_due → 7-day grace).
- **API version** pinned to `2025-03-31.basil` on requests and on the webhook endpoint; the mapping
  also reads the older payload shapes.
- **Switch**: off until the Worker has `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; live keys stay
  off unless `STRIPE_LIVE_ENABLED=true`. The webhook also needs `SUPABASE_SERVICE_ROLE_KEY` (secret
  key of the project). All three are Worker secrets (`wrangler secret put`), never `VITE_` values.
- **Not yet**: per-location quantity sync (prices are flat since 0047), semiannual/annual prepaid
  terms, taxes (Stripe Tax), live mode.

### Operator steps (test mode)

1. Stripe dashboard in test mode → Developers → API keys: a restricted or secret **test** key into
   the operator secrets file (never printed or committed).
2. `node --env-file=<secrets file> scripts/stripe/setup-catalog.mjs --webhook-url
https://app.dinequora.com/api/public/stripe-webhook --secret-out <secrets file>`.
3. `wrangler secret put` STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY on
   the Worker; redeploy not needed for secrets.
4. Test with Stripe's test cards (4242…, 4000 0000 0000 0341 for a failing renewal) and check
   `subscriptions`, `billing_events` and the billing page.
