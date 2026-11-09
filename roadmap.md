# Roadmap

## Backend reconstruction and handoff (current request)
- [x] Reconstruct operational schema additively; 0012–0016 applied, existing tenants/quarantine preserved.
- [x] Connect Menu → POS → Orders → KDS with server-confirmed audited RPCs; isolated SQL regression passed.
- [x] Connect resource persistence and recorded ledger; report limitations in Portuguese handoff.
- [x] Run local tests and isolated PostgreSQL/RLS checks; 192 local tests passed; public login rendered without runtime errors.
- [x] Prepare source export and Portuguese handoff documentation.
- [ ] Hosted authenticated acceptance — blocked: authorized test session/account unavailable.
- [ ] Verify GitHub main synchronization — blocked: only internal remotes visible; user must verify Project settings.
- [ ] Complete report/UI homologation — blocked: hosted acceptance unavailable; known product-margin/unit/Realtime limits are itemized in handoff.

## Done
- Auth, orgs, memberships, invitations, onboarding, protected routes, auth back arrow
- Security phase: tenant-isolation audit (43 checks), audit log, store-level access, org cap, last-owner protection
- Platform Control Center (/control), audited owner assignment + handover; MARAO stays unowned
- Visual pass: KPIs, revenue chart, store comparison, alerts, sidebar, header/account, states, mobile
- i18n review en-US/pt-BR (all keys match; USD unchanged by language)

- Locations module (create/edit/hours/timezone/managers/activate, backend store limit), Team & access (roles, stores, remove, permissions), suspended-org enforcement, billing model + page, admin bootstrap procedure, bilingual email templates, regression tests

- Production hardening: plan-driven store limits (trial/expiry/grace/cancel), privileged-table review, Stripe webhook ledger + apply RPC, billing/email/bootstrap docs, security suites re-run (43/43 + 68/68)

- Control Center v2: overview, org filters/detail, suspend/reactivate, demo studio, settings, per-user language
- Persisted fictional restaurant onboarding/company details, owner-only audited branding with rasterized logos, five saved setup steps; three logo palettes, 20 responsive page visits, store lifecycle/limits and regular-user Control Center denial validated. Report: docs/operations/restaurant-onboarding-validation.md.

## Open
- [x] Phase 0: F01–F07, F11, F22–F24 corrections; local regressions, authenticated failure/retry checks, hours API rejection and four viewport checks. Portuguese report records limited security coverage; full legacy security suites remain in the confirmed-test-account task below.
- [x] Phase 1 final UI validation: role journeys, expired invite, suspension, Control Center denial, two-org switching, branding matrix, 4 viewports × light/dark × en/pt; test data cleaned.
- [ ] Real email delivery (confirmation, reset), Google/Microsoft sign-in end-to-end — blocked: need verified sender domain and real provider login.
- First platform admin bootstrapped 2026-10-23 (operator authorized in chat)
- [ ] Assign MARAO owner — needs owner identity verification
- [ ] Branded auth emails + automatic invite emails — needs sender email domain
- [ ] Stripe TEST mode only (USD): per-location subscriptions, up/downgrade, cancel, failed payment, signed webhooks, status sync, test report — no live mode without explicit OK — blocked: Stripe setup form was declined (paused by user: keep Stripe disconnected until UX validation is done)
- [ ] Real MARAO Location 2/3 details — needs owner input
