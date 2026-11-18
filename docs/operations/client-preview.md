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

## 5. Destinations, dataset, seed, reset and verification

### 5.1 Destinations (the only two)

Every dataset script resolves its destination first with `resolvePreviewTarget`
(`scripts/preview/client-preview-target.mjs`), from the environment only:

| `PREVIEW_TARGET` | Destination                                     | Guard                                                                                                                         |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `local`          | the local **disposable** rehearsal stack (§5.2) | `scripts/guard/target-guard.mjs`: loopback host, database marked disposable by `claim`, protected clusters (QA, demo) refused |
| `hosted`         | the hosted client-preview project               | `scripts/preview/preview-target.mjs` (below)                                                                                  |

Anything else is refused (exit 3). The writer (`scripts/preview/seed-core.mjs`) accepts only the
branded object the resolver returns, so a hand-built destination cannot reach it.

Hosted guard: accepted only when the operation is `seed:client-preview`, `reset:client-preview`,
`verify:client-preview` or `access:client-preview`; the URL is exactly `https://<ref>.supabase.co`; the
confirmation `DQ_PREVIEW_CONFIRM=client-preview:<operation>:<ref>` names this operation and this
project; the key is an `sb_secret_` key or a service_role JWT whose `ref` is this project
(publishable/anon refused); `public.client_preview_identity()` answers with label `client-preview`,
marker version 2 and the same ref; the database holds 0 non-demo organizations, 0 platform roles and
no account outside `.test`/`.example`/`.invalid`/`.localhost` other than the personal owners fixed in
the marker; and those personal owners are exactly the ones the operator declares
(`PREVIEW_PERSONAL_OWNERS`, §5.6). Keys, personal addresses and the expected confirmation are never
printed. There is no override.

### 5.2 Local rehearsal stack (`dq-client-preview`, ports 6473x)

```bash
supabase start --workdir scripts/preview -x studio,imgproxy,vector,logflare,supavisor,edge-runtime,mailpit,storage-api,postgres-meta
# API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY from: supabase status --workdir scripts/preview -o env
node scripts/guard/target-guard.mjs claim --db-url "$DB_URL"          # new and empty only
LOVABLE_DB_MIGRATION_URL="$DB_URL" npx drizzle-kit migrate            # 0000-0029
DB_URL="$DB_URL" node scripts/qa/check-migrations.mjs
docker exec -i supabase_db_dq-client-preview psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < scripts/preview/sql/client-preview-functions.sql
```

Its own identity (`scripts/preview/supabase/config.toml`): not the demo (543xx), not the persistent
QA (553xx), not CI (6442x). Sign-up is off as on the hosted preview (`auth.enable_signup = false`;
never `auth.email.enable_signup`, which CLI 3 reads as the switch of the whole e-mail provider). The
CLI publishes its ports on all interfaces, like every local stack; it only ever holds fictional data.

### 5.3 Dataset (`scripts/preview/dataset.mjs`)

Deterministic (seeded) and fictional: **Dinequora Demo Restaurant** (Growth, active), stores
**Downtown**, **Westside**, **Airport** (America/New_York, 7% / 7% / 7.75% sales tax, opening hours),
5 categories / 19 products (burger add-ons), 31 stock items per store (lb, oz, gal, units, pack), one
recipe per product sold in each store (including gal recipes, priced at the menu product), 4
suppliers, weekly purchase orders received in full plus one open order per store, ~55 expenses, sales
with dine-in/takeout/delivery, card/cash/digital, discounts, ~1.5% cancellations, kitchen steps, and a
live kitchen board (open tickets from the last minutes). Accounts (reserved `.test` domain): the
owner, a Westside manager and a Downtown kitchen account. Food cost ≈ 29% of net sales. Stock is
planned with the server's own consumption rule, so, executed in business-time order, no sale finds
insufficient stock; four items end below their minimum (a recorded closing-check loss) so the alerts
are real.

Names read as a real business (Springfield suppliers and addresses, no "(demo)" tags on rows): the
workspace is marked once, honestly, by the header indicator "Demo workspace · fictional data"
(`is_demo`). Phones stay in the fictional 555-01xx range and accounts in the `.test` domain.

**Expenses (dataset v2).** Each store's costs are a share of its own planned net sales (weekly
payroll ~31%, lease 9%, electricity 3.5%, benefits 3.5%, marketing 3%, maintenance 1.5%, water 1%,
internet 0.4%), so the stores close the period with a plausible positive operating margin whatever the
profile. Every cost is dated the day it is incurred and that day is its competency date: the app
recognizes it only once it has arrived (`isRecognizedInPeriod`), never ahead. Revenue and costs cover
the same days: the part of the first month (and payroll week) inside the history is prorated and
labeled so. Past bills are paid (one overdue electricity bill at Westside, so the alert is real); the
next 14 days of bills are pending. A month-to-date loss in the first days of a month (lease against a
few days of sales) is real and expected; the verifier requires a positive month from the 8th.

Profiles (`PREVIEW_DATASET_PROFILE`):

| Profile                 | Period  | Orders  | Ledger rows     |
| ----------------------- | ------- | ------- | --------------- |
| `ledger-safe` (default) | 22 days | ≈ 410   | ≈ 860 (< 1,000) |
| `full`                  | 36 days | ≈ 3,300 | ≈ 6,800         |
| `presentation`          | 63 days | ≈ 1,160 | ≈ 2,400         |

`presentation` keeps the `ledger-safe` volume over 62 days, so the 7- and 30-day views (Overview,
Reports, Insights) always have a complete previous period to compare with.

**Former limitation, fixed in wave 0:** the screens used to read `finance_entries` in one PostgREST
request, capped at 1,000 rows. Since wave 0 they read the ledger through `fetchLedgerSummary` (day
totals per store, keyset pagination, complete or explicitly marked incomplete) and the export through
`fetchLedgerRows`, so every profile is read completely; `ledger-safe` is simply the smallest.

### 5.4 Seed, reset, verify, smoke test

```bash
export PREVIEW_TARGET=local PREVIEW_API_URL="$API_URL" PREVIEW_SERVICE_KEY="$SERVICE_ROLE_KEY" \
       PREVIEW_PUBLISHABLE_KEY="$ANON_KEY" PREVIEW_CREDS_FILE=<file outside the repo> \
       PREVIEW_PERSONAL_OWNERS="first.owner@personal.test,second.owner@personal.test"  # local stand-ins
node scripts/preview/seed-client-preview.mjs      # first run; refuses if the demo already exists
node scripts/preview/reset-client-preview.mjs     # keeps people, replaces operational data
PREVIEW_TEARDOWN=1 node scripts/preview/reset-client-preview.mjs   # removes everything, seeds nothing
node scripts/preview/verify-dataset.mjs           # read-only checks (exit 1 on any failure)
PREVIEW_APP_URL=http://127.0.0.1:8799 node scripts/preview/smoke-app.mjs   # checks through the app
# hosted: PREVIEW_TARGET=hosted, the project values from the secrets file (real personal owners,
# optional PREVIEW_PERSONAL_OWNER_NAMES), and DQ_PREVIEW_CONFIRM for each operation
```

**The smoke test never contaminates the demonstration.** Its sale is a real order (ledger, stock,
kitchen), so it writes only when the database is local (`127.0.0.1`/`localhost`). Against the hosted
preview it is read-only by default (pages, reads, isolation); the POS/KDS/stock/finance write checks
run there only with `PREVIEW_SMOKE_WRITES=1`, and a **reset must follow** before anyone opens the
preview. `verify-dataset.mjs` fails on the hosted preview while any `cp-smoke-…` order exists. Flagging
the sale as a simulation would not help: the server records simulated sales in the ledger and stock
too. Order of a hosted release: deploy → smoke (read-only) → reset → verify.

- **Seed** writes through the same RPCs as the UI, signed in as the demo owner (organization by
  `create_test_restaurant`, stores, menu, stock, recipes, suppliers, expenses, purchases and receipts,
  POS sales, kitchen statuses, invitations accepted by the manager and kitchen accounts). With the
  server key it only creates the confirmed demo accounts, sets the demo subscription (Growth/active,
  no billing provider, as `seed-demo-orgs.sql`) and calls the dataset functions. Passwords go only to
  the credentials file (outside the repository, mode 600), which must be writable before anything is
  created.
- **Reset** keeps the organization with its settings (brand colours and logo), its stores (name,
  address, phone, hours, time zone, tax rate), the subscription, every member (personal owners and
  demo accounts), their store assignments, permission profiles and invitations — only the first seed
  writes those settings — and replaces only the operational data
  (`public.client_preview_purge_operational`, run before any account is touched); demo accounts get
  new passwords, personal owners keep theirs. Before removing anything it checks that every store is
  active, in the dataset's time zone and at the dataset's tax rate, and that the subscription is
  active; otherwise it stops without changing the setting. Run it before each presentation: the live tickets and
  "today" follow the seed time. **Teardown** (`PREVIEW_TEARDOWN=1`) removes the organization
  (`public.client_preview_purge`), the demo accounts and the personal owners' accounts.
- Every run first refuses a database holding any account outside the demo domain and the declared
  personal owners, or any platform role, before writing anything.
- **Verify** recomputes orders (total, lines, store tax), ledger (revenue, COGS), payments,
  cancellations, stock (quantity = sum of movements), receipts, time coverage, the kitchen board, the
  ledger cap, isolation through RLS (owner, Westside manager, Downtown kitchen, anonymous, no
  platform admin), and the people: the three demo accounts and exactly the declared personal owners,
  each an individual confirmed account, Owner of the demo organization only, joined through an
  accepted Owner invitation, with no open invitation to anyone else, and every member with a display
  name. It also checks the demonstration itself: no smoke-test sale (hosted), every recipe above its
  cost (food cost < 40% of the menu price), a positive result over the last 30 days and month to date
  (from the 8th), and no future expense marked paid.
- **Smoke test** calls the built Worker's server functions as the browser does (pages and headers,
  reads for every store, a POS sale, the kitchen moving it to delivered, the recipe consumption in
  gal, store isolation) and prints the time and size of each call. The ledger is checked in the
  wave 0 contract: `fetchLedgerSummary` per store and for all stores (complete, every row, the same
  totals per kind as a paged read of `finance_entries` under the same RLS, each store in its zone,
  30 days with the same-time-yesterday comparison), `fetchLedgerRows` (every row exactly once),
  resources without raw ledger rows, and ledger isolation (another store, no finance permission, no
  session). The sale and its
  follow-ups run only as described above.

### 5.5 Dataset functions (`scripts/preview/sql/client-preview-functions.sql`)

Installed on the hosted preview after the marker, or on the local disposable stack; refused anywhere
else. `client_preview_backdate` moves the rows the RPCs stamped `now()` (orders, status history,
payments, ledger, stock movements, purchase orders and receipts, opening stock) to the planned
business times (past only, 120-day window, steps in order). `client_preview_purge_operational`
deletes the demo organization's operational rows in dependency order (reset);
`client_preview_purge` does that and then deletes the organization (teardown; audit rows are kept,
with `org_id` set to null). All are `SECURITY DEFINER` with an empty `search_path`, executable by
`service_role` only, and act only on an organization classified as demo.

### 5.6 Personal owners and individual access links

At most **two real people** (`scripts/preview/personal-owners.mjs`), each with an individual Supabase
Auth account and the **Owner** role of the demo organization only (all three stores, settings,
branding) — never a platform role, so the Control Center stays closed.

- Their addresses never enter this public repository: they come from `PREVIEW_PERSONAL_OWNERS` in the
  operator's secrets file and are fixed in the hosted marker (§6). Logs show "personal owner 1/2".
- Optional display names come from `PREVIEW_PERSONAL_OWNER_NAMES` in the same file (comma-separated,
  same order as the addresses; 1–40 letters, spaces or `.'-`). The seed and reset fill a profile name
  only while it is empty, so a name the person set is never overwritten; names are never logged.
- Hosted preview: real addresses only. Local stack: stand-in `.test` addresses only — real people
  never enter a local stack (its target guard treats a database with real accounts as no longer
  disposable).
- The seed creates each account confirmed with a one-time password kept only in memory, invites it
  as Owner (`create_invitation`) and accepts with that single sign-in (`accept_invitation`). Nobody
  knows the final password: each person sets their own.
- `scripts/preview/personal-access-link.mjs` (`access:client-preview`; `PREVIEW_ACCESS_EMAIL`,
  `PREVIEW_APP_URL`, `PREVIEW_LINK_FILE`) writes ONE person's single-use recovery link to a new file
  outside the repository (never overwritten, never printed; the e-mail OTP is discarded), only for a
  declared owner who is an Owner of the demo organization with no platform role, pointing only at the
  preview's `/reset-password` (`*.workers.dev`, `https://preview.dinequora.com`, or a local run for the
  local stack). Send it privately to that person and delete the file. The person first passes
  Cloudflare Access with their own e-mail, then opens the link in the same browser. On Windows the
  file mode is not enforced: keep the file in the operator's own secrets folder.

### 5.7 Direct SQL on the hosted preview (`scripts/preview/hosted-db.mjs`)

The only way to run SQL directly on the hosted project: inspect it, apply the migrations, mark it
and install the dataset functions. Everything comes from the secrets file (environment), never from
the command line:

```bash
PREVIEW_DB_OPERATION=inspect|migrate|mark|functions \
PREVIEW_API_URL=https://<ref>.supabase.co \
PREVIEW_DB_URL=<Session pooler connection string of the project> \
PREVIEW_FORBIDDEN_REFS=<ref of production>[,<other hosted projects>] \
PREVIEW_DB_CA_FILE=<Supabase server root certificate (PEM)> \
DQ_PREVIEW_CONFIRM=client-preview:db-<operation>:client-preview:<ref> \
PREVIEW_PERSONAL_OWNERS=<mark only> node scripts/preview/hosted-db.mjs
```

Before any connection: a known operation; the API URL of the project; `PREVIEW_FORBIDDEN_REFS`
declared (production at least) and not containing this ref, so production is blocked by name even if
every other value were copied from it; the operator confirmation for this operation and project; and
a database URL that is the **Session pooler of this project** — host `aws-…pooler.supabase.com`, port
5432, database `postgres`, user `postgres.<ref>` with the same ref as the API URL (the pooler host is
shared by many projects; the user name selects the project), a real password, and no option other
than `sslmode=verify-full`. Local and private hosts (the QA, the demo, CI), the direct host, the
transaction pooler (6543) and any other host are refused.

**TLS is always fully verified.** The server certificate chain must lead to a CA certificate of
`PREVIEW_DB_CA_FILE` and the certificate must be issued for the pooler host name (`verify-full`
semantics). The pooler's chain ends in Supabase's own root, which no system trust store contains, so
the file is required: download the server root certificate from the project (Database Settings > SSL
Configuration) and keep it with the secrets file. `hosted-db` refuses a missing file, anything that
is not a certificate, a private key, a certificate that is not a CA, and a CA outside its validity
period, and prints the subject, expiry and SHA-256 fingerprint of what it will trust (compare the
fingerprint with the dashboard's certificate). This process trusts only that file
(`rejectUnauthorized: true`, Node's own host-name check, TLS 1.2 or newer); the `drizzle-kit` child
connects with `sslmode=verify-full` and gets the same file through `NODE_EXTRA_CA_CERTS` (its driver
then trusts Node's default store plus that file). Encryption without verification
(`sslmode=require`, `prefer`, `allow`, `disable`, `verify-ca`, `NODE_TLS_REJECT_UNAUTHORIZED=0`) is
refused, and nothing in the file can turn verification off. A failed verification stops before
anything (start-up message, password) is sent to the server.

After connecting, in a read-only session, the state decides what may run:

| State               | Meaning                                                                                         | Allowed                        |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| `empty`             | nothing in `public`, no tracker, no account, no stored object                                   | `migrate` (first)              |
| `migrated-unmarked` | every migration of this repository applied, no data, no marker                                  | `mark`                         |
| `preview`           | marked for this ref, no real data, no platform role                                             | `migrate` (later), `functions` |
| anything else       | another project's marker, a local stack, tables without a tracker, a partial history, real data | `inspect` only                 |

`migrate` runs `drizzle-kit migrate` in a child process with a minimal environment and gives the
repository's migration gate its `migrate:remote:<host>` confirmation only after every check above;
this session never writes. `mark` and `functions` render the psql scripts (`\set ON_ERROR_STOP on`
dropped, `:'variable'` quoted; any other psql command refused) and run each as one batch, so a
refusal inside the file rolls everything back; the session is writable only for that batch. Then
PostgREST is told to reload its schema and the state is read again. Passwords, keys, complete URLs
and personal addresses are never printed; database and child messages are redacted.

## 6. Identity marker

`scripts/preview/sql/client-preview-identity.sql` (marker version 2) is run once on the preview
project after its migrations, through `hosted-db.mjs` (`PREVIEW_DB_OPERATION=mark`, §5.7); with psql
the equivalent is `-v project_ref=<ref> -v personal_owners=<PREVIEW_PERSONAL_OWNERS> -f …`.
It is not a migration and never reaches QA or production, and it never echoes the addresses. Before
writing, it refuses a missing/malformed ref, a malformed personal-owner list (more than two,
duplicates, not an address, a reserved test domain), missing migrations, an already marked database, a
local disposable stack (`dq_guard`), non-demo organizations, any account outside the reserved test
domains, and platform roles. It creates `dq_preview.marker` (the ref the database was marked for; a
copy restored into another project no longer matches), `dq_preview.personal_accounts` (the fixed
personal owners: not reachable through the API, and a trigger refuses any later insert or update) and
`public.client_preview_identity()`, `SECURITY DEFINER` with an empty `search_path`, executable by
`service_role` only, which reports real accounts outside the fixed list (must be 0) and the list.

Demo accounts use the reserved test domain `…@client-preview.dinequora.test`; the preview never gets a
platform admin, so `/control` and every `admin_*` RPC stay closed.

## 7. Tests

`src/test/client-preview-profile.test.tsx`, `client-preview-social.test.ts`,
`client-preview-security-headers.test.ts`, `client-preview-guard.test.ts`,
`client-preview-build.test.ts`, `client-preview-dataset.test.ts`, `client-preview-personal.test.ts`
and `client-preview-hosted-db.test.ts` cover the profile, the headers through the real `src/server.ts`, the
guards and the repository policy (every script that writes resolves its destination first; the
dataset functions act on demo organizations only; a reset keeps people; no personal mailbox address in
any client-preview file), the build and bundle checks, the dataset (determinism, app contracts, stock
never short, fictional data, ledger cap), and the personal owners (declaration rules per mode, the
fixed marker list, individual links that never reach a log), and direct SQL on the hosted preview
(pooler URL and ref rules, production blocked by name, database states, psql-file rendering,
migration child process, redaction). No unit test reaches a network or a database; `verify-dataset.mjs` and `smoke-app.mjs` are the
database and end-to-end checks.

## 7a. Worker exposure: workers.dev only, version preview URLs off

The preview is protected by a Cloudflare Access application on its workers.dev host only. Version
preview URLs (`<version>-<worker>.<subdomain>.workers.dev`) are other hosts, outside that application,
and `wrangler deploy` turns them ON whenever the config does not set `preview_urls` (observed on
2026-11-16; reverted within a minute). The build therefore writes `"workers_dev": true` and
`"preview_urls": false` into `.output/server/wrangler.json` (`hardenOutput`), and `verify-bundle.mjs`
fails a build without them or with routes/custom domains. After any deploy, still confirm on the
Worker (read-only) that previews are disabled and that a version URL answers 404.

## 8. Remaining risk for Workers Free

The resources read (`fetchOperationalResources`) answers 260–360 KiB per store and ~900 KiB for "All
stores" with the `ledger-safe` dataset; parsing and serializing that much may exceed the 10 ms of CPU
per request of Workers Free (error 1102). It can only be measured on the deployed Worker: run the
smoke test against `*.workers.dev` and read the Worker logs before any presentation.
