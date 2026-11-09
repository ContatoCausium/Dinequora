# Production e-mail (Resend or other SMTP) — readiness report

Status on 2026-11-08: **nothing configured for production.** Local development uses the Supabase CLI mail catcher
(Mailpit at `http://127.0.0.1:54324`, successor of Inbucket). This document lists what is required before any real
e-mail is sent. Complements `email-delivery.md` (what exists today) — read that first.

## What was verified locally
| Flow | Sender | Local result |
|---|---|---|
| Sign-up confirmation | Supabase Auth | Delivered to Mailpit; link redirects to `/auth` and confirms the user |
| Password recovery | Supabase Auth | Delivered; link redirects to `/reset-password?recovery=1` with a recovery session |
| Invitation | App (`create_invitation`) | **No e-mail by design** — the owner copies the link from Team & access |
| Invitation accepted / security notices | App | **Not sent** — templates exist in `src/lib/email-templates.ts`, no sender wired |

Local settings live in `supabase/config.toml` (`[auth]`, `[auth.email]`, `[auth.rate_limit]`). They only affect
`supabase start`; hosted projects take auth settings from the dashboard / Lovable Cloud.

## 1. Two separate channels
1. **Auth e-mails** (confirmation, recovery, e-mail change, reauthentication, magic link if enabled) are sent by
   Supabase Auth through its **custom SMTP** setting. Supabase's built-in sender is for testing only and is heavily
   rate-limited, so production requires custom SMTP.
2. **Application e-mails** (invitation, invitation accepted, security notices) need a **server-side** sender
   (server function or edge function) calling the provider's API. Never from the browser.

## 2. Provider account and domain (Resend example)
- Create the Resend account under the company, not a personal address; enable 2FA.
- Use a dedicated sending subdomain, e.g. `notify.<domain>`, so marketing/transactional reputation stays separate.
- DNS records Resend issues for that subdomain: **SPF** (TXT/MX for the bounce path) and **DKIM** (TXT). Add a
  **DMARC** record on the parent domain (start with `p=none` + reporting, tighten to `quarantine`/`reject` later).
- Wait for domain verification before sending anything.
- Sender identity: e.g. `Servora <no-reply@notify.<domain>>`, plus a monitored `Reply-To` (support inbox).

## 3. Supabase Auth custom SMTP (hosted project)
Set in the hosted project's Auth → SMTP settings (or the equivalent Lovable Cloud email settings, since this project
is connected to Lovable):
- Host `smtp.resend.com`, port `465` (implicit TLS) or `587` (STARTTLS), username `resend`,
  password = a **Resend API key with sending-only permission, restricted to the sending domain**.
- Sender e-mail / name as above.
- Raise the Auth e-mail rate limit to the expected volume (default with custom SMTP is low).
- **Site URL** = production app origin; **Redirect allow-list** = only the production (and staging) origins,
  e.g. `https://app.<domain>/**`. Remove `localhost` entries from hosted projects.
- Keep "Confirm e-mail" enabled; keep "Secure e-mail change" enabled.

Secrets: the SMTP password/API key is stored only in the provider dashboard / server secrets. It must never be in
`VITE_*` variables, the repository, `.env` files committed to Git, or client bundles.

## 4. Branded templates
- Port subject/body from `renderEmail()` (en-US and pt-BR) into the Auth templates. Auth templates are per project,
  not per user language: either use one bilingual template or send auth mail through a server hook that picks
  `preferred_language` from user metadata.
- Keep links as the provided `{{ .ConfirmationURL }}`-style tokens; never build action links client-side.
- Tenant white-label: auth e-mails are platform-branded (the user may belong to several tenants); app e-mails may use
  the organization's name/colors read server-side from `organizations`.

## 5. Application sender (invitations and notices)
- One server function, triggered after `create_invitation`, `accept_invitation` and audited security events
  (role change, ownership transfer, platform role change). Recipient and content derived from the database, not from
  request input; the invitation token is passed only from the RPC result to the sender, never logged.
- Resend API key in a **server-only** secret (separate key from the SMTP one, scoped to the domain).
- Idempotency: one send per invitation id / audit event id (store a send log with provider message id + status).
- Only after this ships, change the Team & access copy to say the invitation was e-mailed (AGENTS.md rule).

## 6. Deliverability and compliance
- Configure Resend webhooks (delivered, bounced, complained) to a server endpoint; suppress addresses that bounce or
  complain and surface failures in the Control Center.
- Transactional only: no tracking pixels on auth mail; include the company postal address and a support contact.
- Data protection (LGPD/GDPR): document the provider as a processor; minimise personal data in e-mail bodies.

## 7. Rollout checklist
1. Domain verified (SPF, DKIM, DMARC passing — check with a mail-tester tool).
2. Staging project: custom SMTP + templates; run sign-up, recovery, e-mail change, invitation end to end.
3. Confirm redirect URLs land on the staging origin and expired/used links show the proper error page.
4. Load check against rate limits; verify bounce webhook handling.
5. Production: same settings, separate API keys; monitor the first 48 h of sends.

## Out of scope here
No SMTP, API key, DNS record or hosted-project setting was created or changed while preparing this report.
