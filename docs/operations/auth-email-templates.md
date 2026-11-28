# Auth e-mail templates (Supabase)

Branded, bilingual templates for the six Supabase Auth e-mails: confirm sign-up, reset password,
magic link, change e-mail, invite user and reauthentication code.

- Source: `scripts/email/build-auth-templates.mjs` (text, colours, layout).
- Output (committed): `supabase/templates/<name>.html` and `supabase/templates/subjects.json`.
  Rebuild with `node scripts/email/build-auth-templates.mjs`; `src/test/auth-email-templates.test.ts`
  fails when the committed files differ from the generator.
- Language: Supabase keeps one template per project. Each template reads the user's sign-up
  metadata `preferred_language` (set by the sign-up form): `pt-BR` gets Portuguese, everyone else
  English. The check is nil-safe, so a user without metadata still gets the English e-mail.
- Links: only Supabase's own `{{ .ConfirmationURL }}` / `{{ .Token }}` and the support mailbox.
- Logo: `public/email/dinequora-mark.png` (the brand mark, 144 px PNG: e-mail clients do not show
  SVG), loaded from `https://app.dinequora.com/email/dinequora-mark.png`. Deploy the app with it
  before applying the templates, or the e-mails show a broken image.

## Applying to a hosted project (operator, with the owner's OK)

Authentication → Emails → Templates, for each of the six e-mails:

| Dashboard template   | File                    | Subject key        |
| -------------------- | ----------------------- | ------------------ |
| Confirm sign up      | `confirmation.html`     | `confirmation`     |
| Invite user          | `invite.html`           | `invite`           |
| Magic link           | `magic_link.html`       | `magic_link`       |
| Change email address | `email_change.html`     | `email_change`     |
| Reset password       | `recovery.html`         | `recovery`         |
| Reauthentication     | `reauthentication.html` | `reauthentication` |

Paste the subject from `subjects.json` and the whole HTML file, save, then send one real e-mail
(for example a password reset of an operator account) and check it arrives rendered in the right
language. If a template fails to render, Supabase does not send the e-mail: restore the previous
template and investigate.
