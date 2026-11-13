# Client Preview (commercial demonstration environment)

A separate, online copy of the app for presenting Dinequora to prospective customers: a Cloudflare
Worker (`dinequora-client-preview`, planned domain `preview.dinequora.com`) backed by a dedicated
Supabase project (Micro, in the existing Pro organization, separate from QA and production) holding
only fictional data. It is not production and never connects to production, the QA or the local demo.

Every step that creates, changes or publishes something (Supabase project, migrations, marker, seed,
reset, Worker, domain, accounts) needs the owner's explicit authorization for that step.

## 1. Build profile

`VITE_DEPLOYMENT_PROFILE=client-preview` is a build-time value (inlined by Vite into the browser and
SSR bundles; it cannot be changed at runtime). `src/lib/deployment-profile.ts` reads it and fails
closed: any non-empty value other than `standard` means `client-preview`.

| Area                    | Standard profile                              | Client preview                                                  |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| Sign-in screen          | "Create an account" link                      | no sign-up link                                                 |
| `/signup`               | sign-up form                                  | redirects to `/auth`                                            |
| Invitation screen       | "Create account to join" + "Sign in to join"  | "Sign in to join" only                                          |
| Social sign-in          | `VITE_AUTH_SOCIAL_PROVIDERS`                  | always off                                                      |
| Presentation mode (B1)  | offered to demo-classified orgs               | never available (the preview shows its recorded synthetic data) |
| Server response headers | unchanged (the Lovable editor frames the app) | see §2                                                          |
| Indexing                | unchanged                                     | `robots` meta, `X-Robots-Tag`, `robots.txt` `Disallow: /`       |

Sign-ups must also be disabled in the preview project's Supabase Auth settings; the UI change only
removes the entry points.

## 2. Security headers

`src/server.ts` wraps every server response (pages, server functions, redirects, the catastrophic SSR
fallback and the error page) with `withSecurityHeaders` (`src/lib/security-headers.ts`):

- `X-Robots-Tag: noindex, nofollow, noarchive`
- `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Strict-Transport-Security: max-age=31536000` over https only

No `script-src`/`style-src` policy yet: SSR streams inline hydration scripts and the app loads Google
Fonts, so a full CSP needs its own validation. Static assets are served by the platform without the
server; the build writes the no-index and hardening headers for them into `.output/public/_headers`.

## 3. Build

```bash
# clean checkout of the approved commit, no .env / .env.local / .env.client-preview
cp .env.example .env.client-preview.local   # then keep only the public values below
npm ci
npm run build:client-preview -- --expect-ref <project ref>
# build test without a real project:
npm run build:client-preview -- --placeholder
```

`.env.client-preview.local` (git-ignored) may hold only `VITE_SUPABASE_URL`
(`https://<ref>.supabase.co`), `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable/anon key of that project),
an empty `VITE_AUTH_SOCIAL_PROVIDERS` and an optional `VITE_SUPPORT_EMAIL`.
`scripts/preview/build-client-preview.mjs` refuses before building when `.env`, `.env.local` or
`.env.client-preview` exist, when the shell exports `VITE_*`, `SUPABASE_*`, `NITRO_*`/`SERVER_PRESET`
or `LOVABLE_*`, when the file has any other key, or when the URL/key are not public values of the
project named by `--expect-ref`. It forces the profile, builds with `vite build --mode client-preview`
(preset `cloudflare-module`), writes `robots.txt` and `_headers`, names the Worker, and runs the
bundle check. Nothing is deployed.

Runtime values of the Worker (set in the Worker settings at deploy time, never in `wrangler.json`):
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `OBSERVABILITY_ENVIRONMENT=client-preview`. Never set a
service-role/secret key, `RESEND_*`, Stripe values or `LOVABLE_CRON_SECRET` on the Worker.

## 4. Bundle check

`scripts/preview/verify-bundle.mjs` (also `npm run verify:client-preview`, with
`PREVIEW_EXPECTED_SUPABASE_URL` and `PREVIEW_EXPECTED_PUBLISHABLE_KEY`) fails when `.output` contains:
any JWT that is not the expected anon key, an `sb_secret_` key, another publishable key, another
Supabase project, a local/private backend URL (library constants `http://localhost:9999`,
`http://localhost:3000`, `http://127.0.0.1` and the TanStack Router fallback `http://localhost`, all without any other port, are allowed), a database connection string, the local
demo id, the QA or production project names, server-only key readers (service role, cron, Resend,
Stripe), operator deny-list strings (`PREVIEW_BUNDLE_DENY`, comma-separated, e.g. other project refs;
reported by index only), local wrangler state, source maps, a build path in a public file, a missing
profile/URL/key, a Worker not named `dinequora-client-preview`, `vars`/bindings in `wrangler.json`,
or missing `robots.txt`/`_headers` hardening. Findings never print the matched value. A build path in
the server-side route manifest is a warning (not served; build from a neutral path to avoid it).

## 5. Seed and reset guard

`scripts/preview/seed-client-preview.mjs` and `scripts/preview/reset-client-preview.mjs` call
`assertClientPreviewApi` (`scripts/preview/preview-target.mjs`) before anything else. The destination
is read from the environment only:

```bash
PREVIEW_API_URL=https://<ref>.supabase.co \
PREVIEW_SERVICE_KEY=<secret key of that project, from a file outside the repo> \
DQ_PREVIEW_CONFIRM=client-preview:seed:client-preview:<ref> \
node scripts/preview/seed-client-preview.mjs
# reset: DQ_PREVIEW_CONFIRM=client-preview:reset:client-preview:<ref>
```

Accepted only when: the operation is `seed:client-preview` or `reset:client-preview`; the URL is
exactly `https://<ref>.supabase.co` (local and private hosts are refused and belong to
`scripts/guard/target-guard.mjs`, which keeps refusing every hosted database); the confirmation names
this operation and this project; the key is an `sb_secret_` key or a service_role JWT whose `ref` is
this project (publishable/anon keys refused); `public.client_preview_identity()` answers with label
`client-preview`, marker version 1 and the same project ref; and the database holds 0 non-demo
organizations, 0 accounts outside `.test`/`.example`/`.invalid` and 0 platform roles. Any failure,
timeout or unexpected answer is a refusal (exit 3); keys and the expected confirmation are never
printed. There is no override.

**Stage 2 status:** both scripts implement the guard only. After a successful check they stop
(exit 4) without writing; the dataset (Dinequora Demo Restaurant, Downtown / Westside / Airport, menu,
stock, recipes, sales history) and the reset steps are a separate, separately authorized change.

## 6. Identity marker

`scripts/preview/sql/client-preview-identity.sql` is run once by the operator on the preview project
after its migrations (`psql "<connection>" -v project_ref=<ref> -f …`). It is not a migration and
never reaches QA or production. Before writing, it refuses a missing/malformed ref, missing
migrations, an already marked database, a local disposable stack (`dq_guard`), non-demo
organizations, accounts outside the reserved test domains and platform roles. It creates
`dq_preview.marker` (the ref the database was marked for; a copy restored into another project no
longer matches) and `public.client_preview_identity()`, `SECURITY DEFINER` with an empty
`search_path`, executable by `service_role` only.

The preview accounts therefore use reserved test domains (e.g. `…@client-preview.dinequora.test`),
and the preview never gets a platform admin, so `/control` and every `admin_*` RPC stay closed.

## 7. Tests

`src/test/client-preview-profile.test.tsx`, `client-preview-social.test.ts`,
`client-preview-security-headers.test.ts`, `client-preview-guard.test.ts` and
`client-preview-build.test.ts` cover the profile, the headers through the real `src/server.ts`, the
guard (URL, confirmation, key, identity, real-data refusals, repository policy) and the build and
bundle checks. No test reaches a network or a database.
