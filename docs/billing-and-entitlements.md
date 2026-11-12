# Plans, entitlements and Stripe Billing (prepared, not active)

## Entitlements (live now)
- Plan definitions live only in `billing_plans`: `default_store_limit` (paid), `trial_store_limit` (trial), `trial_days`, `entitlements` (modules, employees).
- An organization's plan is `subscriptions.plan_id`. `organizations.plan` / `organizations.store_limit` are derived caches kept in sync by the `subscription_sync_entitlements` trigger — never written by app code.
- `effective_store_limit(org)` = `organizations.store_limit_override` (operator exception, audited) else the plan's trial or paid allowance.
- `create_location` and `set_location_status` (reactivation) check `active_store_count < effective_store_limit` under a row lock. Inactive stores do not count.
- Downgrade below current usage keeps existing stores running but blocks new stores and reactivations until the count fits.
- Operational = org not suspended AND subscription is: trialing before `trial_ends_at`, active, past_due, incomplete, or grace before `grace_ends_at`. Expired trial, expired grace, unpaid and canceled block every write RPC (`subscription_inactive`).
- Plans/status change only through `admin_set_subscription` / `admin_update_organization` (platform admin, reason required, audited) or, later, the verified Stripe webhook.

## Privileged tables
| Table | Users | Platform admins | Service role |
|---|---|---|---|
| `subscriptions` | owner reads own org | via admin RPCs only | full |
| `billing_events` | owner reads own org; no writes | no direct read | full (webhook) |
| `billing_plans` | read active plans | — | full |
| `stripe_webhook_events` | none | none | full |
| `platform_bootstrap` | none | none | via `bootstrap_first_platform_admin` |
| `audit_logs` | owners/managers read own org | read all | insert via `write_audit` only |
Verified by `scripts/security/regression_locations_team.py`, now retired (PR #23: it wrote to whatever URL its .env named, with no target protection). These billing refusals are not yet covered by the guarded suite: porting them to an SQL fixture or the permission matrix is pending (payment fabrication, subscription writes, override writes, webhook ledger, Stripe RPC all blocked).

## Stripe Billing design (do not enable live without approval)
- **Product**: one product "Servora" with one monthly recurring price per plan, `quantity = billed active locations`. `billing_plans.stripe_price_id` maps plan → price.
- **Customer mapping**: one Stripe customer per organization, created at first checkout; `subscriptions.stripe_customer_id`, `metadata.org_id` on customer and subscription.
- **Checkout**: authenticated server function (owner only, verified with `is_org_owner`) creates a Checkout Session (mode `subscription`, price + quantity, `client_reference_id = org_id`). The browser is only redirected; it never reports success.
- **Billing portal**: owner-only server function creates a portal session for the stored customer (update card, cancel, invoices).
- **Webhook**: `/api/public/stripe-webhook` verifies the `Stripe-Signature` header against the webhook secret on the raw body, rejects otherwise, then calls `billing_apply_stripe_event` with the service role. Events: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.
- **Idempotency**: `billing_apply_stripe_event` inserts the event id into `stripe_webhook_events` first; duplicates return `false` and change nothing.
- **Payment failure / grace**: first `past_due` → `grace` with 7 days; `active` clears grace; `unpaid`/`canceled` block writes; data is kept (read-only).
- **Cancellation**: portal sets `cancel_at_period_end`; access continues until `current_period_end`, then `customer.subscription.deleted` → `canceled`.
- **Quantity sync**: when active store count changes, a server function updates the subscription item quantity (prorated).
- Prices in `billing_plans` are placeholders (`is_placeholder_pricing`) until approved.
