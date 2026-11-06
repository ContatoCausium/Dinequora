<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Tenant data lives in `src/lib/tenants.ts`; components never hardcode a tenant name or brand — read from `useWorkspace()`. Keeps the product white-label.
- Theme colors come only from `generateTheme()` in `src/lib/theme-engine.ts`, applied as CSS variables; components use semantic tokens. Guarantees contrast for any tenant brand.
- Persisted restaurant branding is authoritative in organization rows, changed only by owner-authorized audited RPCs; uploaded SVGs are rasterized before saving bounded image data URLs. Keeps logos private under tenant RLS and prevents executable uploads.
- Pre-launch restaurant creation uses `create_test_restaurant` and an onboarding checklist derived from persisted data (`src/lib/onboarding-checklist.ts`, mirrored by `set_onboarding_step` server checks); it explicitly classifies fictional organizations without automatically granting platform admins access to existing tenants.
- All UI strings go through react-i18next namespaces in `src/locales/<lang>/*.json` (en-US default, pt-BR); numbers/dates use `src/lib/format.ts` (Intl). Adding a language = adding a folder.
- Synthetic figures come from `src/lib/demo-data.ts` (seeded, deterministic for SSR) and must stay labeled as demo data in the UI.
- Modules not yet built appear as disabled "Coming next" nav items, never as fake pages.
- Identity goes only through the `AuthService` in `src/lib/auth/` (adapter in `supabase-adapter.ts`); UI never imports the backend auth client. Lets us swap auth providers.
- Organization/membership/invitation data access lives in `src/lib/org-service.ts`, separate from auth. Access is granted only by membership rows created via security-definer RPCs (create_organization, accept_invitation); never auto-grant org access or platform roles.
- Signed-in pages live under `src/routes/_authenticated/_app/` (gate + workspace shell); public auth pages are top-level routes using `AuthLayout`. Post-auth redirects must pass `safeRedirect`.
- Platform administration lives only under `/control/*` (layout `control.tsx` + child routes) and `src/lib/admin-service.ts`, backed by `admin_*` security-definer functions that check `is_platform_admin()` and write `audit_logs`. Platform admins get no tenant access through RLS; customer metrics exclude `is_demo` orgs and revenue is "unavailable" unless billing is provider-synced (`src/lib/platform-metrics.ts`). The Demo studio is browser-only and never writes. Keeps SaaS operator and restaurant permissions separate.
- Store-level access: only owners are org-wide; managers and staff see only stores in `member_location_access` (DB `can_access_location`, mirrored in `fetchMemberships` and `src/lib/access-rules.ts`). Managers manage only staff inside their stores. UI must handle zero stores.
- Sensitive changes (membership, invitations, ownership, org status/plan/limits, platform roles) are audited by DB triggers/functions; `audit_logs` is not writable by clients.
- `scripts/security/` holds the tenant-isolation regression check; re-run it after any RLS or RPC change.
- Business modules follow `docs/authorization-patterns.md`: org/location-scoped tables, read via RLS helpers, writes only through security-definer RPCs that call `assert_org_operational` and `write_audit`. Keeps suspended orgs and cross-tenant writes blocked at the backend.
- Billing state lives in `subscriptions`/`billing_plans`/`billing_events`, readable by owners only and changed only by platform-admin RPCs or the service-role `billing_apply_stripe_event` (idempotent via `stripe_webhook_events`). Store allowance is derived by `effective_store_limit()` from the plan (+ audited operator override); `organizations.plan/store_limit` are trigger-synced caches. See `docs/billing-and-entitlements.md`. No client writes, so payment state can't be forged.
- The first platform admin is created only via the service-role `bootstrap_first_platform_admin` (one-time, see `docs/operations/`). Never expose it to clients.
- Email templates in `src/lib/email-templates.ts` are prepared but unsent until a verified sender domain exists; the UI must not claim emails are sent.

- Location hours use matching client validation and a database validation trigger on hours/status writes; overnight intervals are valid and equal/malformed times are rejected without changing RLS or write RPCs. Prevents activation/API paths bypassing validation.
- Control Center reads expose loading, empty, classified failure and retry separately; integration success is shown only after an actual authorized probe. Prevents misleading health and indefinite loaders.
- Saved/browser language is applied only after hydration settles (`applyClientLanguageAfterHydration`); SSR always renders the default language. Prevents hydration mismatches on public pages.
- Catastrophic SSR fallback reads the shared locale dictionaries and the request language header without auth or browser dependencies. Keeps recovery available when React cannot render.
- TypeScript runs fully strict (exactOptionalPropertyTypes, noPropertyAccessFromIndexSignature) with no check suppressions; optional fields that may be explicitly empty are typed `?: T | undefined`. Keeps contract drift visible.
- Operational Menu/POS/KDS use authenticated `operational.functions.ts`; user-RLS reads resolve UI slugs to UUIDs and audited RPCs own prices, atomic consumption and reversal. Original adapters stay in docs/pending-migrations; capability flags never imply homologation.
- Browser-persisted business data uses per-org keys (`src/lib/tenant-storage.ts` or `assertTenantContext`). Services take an optional authorized-store list (undefined = owner) enforced on every read/write; org-wide records are owner-writable only; examples seed only the `demo` org; legacy v1 global keys are only counted and quarantine-flagged, never read or deleted. Prevents cross-tenant/cross-store exposure.
