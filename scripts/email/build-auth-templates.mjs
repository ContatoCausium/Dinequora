// Builds the branded, bilingual Supabase Auth e-mail templates into supabase/templates/.
//
//   node scripts/email/build-auth-templates.mjs
//
// One HTML file per Auth e-mail (Supabase has one template per project, not per language). The
// language comes from the user's sign-up metadata (`preferred_language`, set by the sign-up form):
// pt-BR gets Portuguese, everyone else English. The check is nil-safe on purpose: a Go template error
// would stop the e-mail from being sent. Links are always Supabase's own tokens ({{ .ConfirmationURL }},
// {{ .Token }}); nothing builds an action link here.
//
// The same files are used by the local stack (supabase/config.toml) and pasted into the hosted
// project's Authentication > Emails > Templates (docs/operations/auth-email-templates.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT_DIR = path.join(ROOT, "supabase/templates");

const C = {
  primary: "#b5452a",
  ink: "#1d1713",
  body: "#4a433e",
  muted: "#68625d",
  border: "#e5e2df",
  sand: "#f2f0ec",
  soft: "#fcf3f1",
};
const SUPPORT = "support@dinequora.com";
/**
 * The brand mark as a PNG (e-mail clients do not show SVG), served by the production app from
 * public/email/. Absolute URL: the e-mail is read outside the app.
 */
export const LOGO_URL = "https://app.dinequora.com/email/dinequora-mark.png";

/** Text of each e-mail. `action` is the Go template expression of the link (null: a code e-mail). */
export const TEMPLATES = {
  confirmation: {
    action: "{{ .ConfirmationURL }}",
    en: {
      subject: "Confirm your Dinequora account",
      preheader: "One click to finish creating your account.",
      heading: "Confirm your email",
      body: "Welcome to Dinequora. Confirm your email address to finish creating your account.",
      cta: "Confirm email",
      footer:
        "You received this email because this address was used to create a Dinequora account. If that wasn't you, you can ignore it.",
    },
    pt: {
      subject: "Confirme sua conta Dinequora",
      preheader: "Um clique para concluir a criação da sua conta.",
      heading: "Confirme seu e-mail",
      body: "Boas-vindas ao Dinequora. Confirme seu endereço de e-mail para concluir a criação da sua conta.",
      cta: "Confirmar e-mail",
      footer:
        "Você recebeu este e-mail porque este endereço foi usado para criar uma conta Dinequora. Se não foi você, pode ignorá-lo.",
    },
  },
  recovery: {
    action: "{{ .ConfirmationURL }}",
    en: {
      subject: "Reset your Dinequora password",
      preheader: "Choose a new password for your account.",
      heading: "Reset your password",
      body: "We received a request to reset the password of your Dinequora account. The link can be used once.",
      cta: "Choose a new password",
      footer:
        "If you didn't ask for this, you can ignore this email: your password stays the same.",
    },
    pt: {
      subject: "Redefina sua senha Dinequora",
      preheader: "Escolha uma nova senha para sua conta.",
      heading: "Redefinir senha",
      body: "Recebemos um pedido para redefinir a senha da sua conta Dinequora. O link pode ser usado uma vez.",
      cta: "Escolher nova senha",
      footer: "Se você não pediu isso, ignore este e-mail: sua senha continua a mesma.",
    },
  },
  magic_link: {
    action: "{{ .ConfirmationURL }}",
    en: {
      subject: "Your Dinequora sign-in link",
      preheader: "Sign in to Dinequora with one click.",
      heading: "Sign in to Dinequora",
      body: "Use the button below to sign in. The link can be used once.",
      cta: "Sign in",
      footer: "If you didn't ask for this link, you can ignore this email.",
    },
    pt: {
      subject: "Seu link de acesso ao Dinequora",
      preheader: "Entre no Dinequora com um clique.",
      heading: "Entrar no Dinequora",
      body: "Use o botão abaixo para entrar. O link pode ser usado uma vez.",
      cta: "Entrar",
      footer: "Se você não pediu este link, pode ignorar este e-mail.",
    },
  },
  email_change: {
    action: "{{ .ConfirmationURL }}",
    en: {
      subject: "Confirm your new Dinequora email",
      preheader: "Confirm the change of your account email.",
      heading: "Confirm your new email",
      body: "Confirm that {{ .NewEmail }} should become the email address of your Dinequora account.",
      cta: "Confirm new email",
      footer: "If you didn't ask for this change, ignore this email and reset your password.",
    },
    pt: {
      subject: "Confirme seu novo e-mail Dinequora",
      preheader: "Confirme a troca do e-mail da sua conta.",
      heading: "Confirme seu novo e-mail",
      body: "Confirme que {{ .NewEmail }} deve passar a ser o e-mail da sua conta Dinequora.",
      cta: "Confirmar novo e-mail",
      footer: "Se você não pediu essa troca, ignore este e-mail e redefina sua senha.",
    },
  },
  invite: {
    action: "{{ .ConfirmationURL }}",
    en: {
      subject: "You're invited to Dinequora",
      preheader: "Accept the invitation to create your account.",
      heading: "You're invited",
      body: "You were invited to create a Dinequora account. Accept the invitation to choose your password.",
      cta: "Accept invitation",
      footer: "If you weren't expecting this invitation, you can ignore it.",
    },
    pt: {
      subject: "Você foi convidado para o Dinequora",
      preheader: "Aceite o convite para criar sua conta.",
      heading: "Você foi convidado",
      body: "Você recebeu um convite para criar uma conta Dinequora. Aceite o convite para escolher sua senha.",
      cta: "Aceitar convite",
      footer: "Se você não esperava este convite, pode ignorá-lo.",
    },
  },
  reauthentication: {
    action: null,
    en: {
      subject: "Your Dinequora verification code",
      preheader: "Your code to confirm a sensitive change.",
      heading: "Confirm it's you",
      body: "Enter this code in Dinequora to confirm the change you started:",
      footer: "If you didn't start a change, someone may know your password: reset it right away.",
    },
    pt: {
      subject: "Seu código de verificação Dinequora",
      preheader: "Seu código para confirmar uma alteração sensível.",
      heading: "Confirme que é você",
      body: "Digite este código no Dinequora para confirmar a alteração que você iniciou:",
      footer:
        "Se você não iniciou nenhuma alteração, alguém pode saber sua senha: redefina-a imediatamente.",
    },
  },
};

/** Nil-safe: true only when the sign-up metadata says pt-BR. */
export const LANG =
  '{{ $pt := false }}{{ with .Data }}{{ if eq (printf "%v" .preferred_language) "pt-BR" }}{{ $pt = true }}{{ end }}{{ end }}';
const pick = (en, pt) => `{{ if $pt }}${pt}{{ else }}${en}{{ end }}`;

export const subjectTemplate = (t) => `${LANG}${pick(t.en.subject, t.pt.subject)}`;

export function htmlTemplate(t) {
  const p = (k) => pick(t.en[k], t.pt[k]);
  const action = t.action
    ? `<tr><td style="padding:8px 0 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${C.primary}"><a href="${t.action}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${p("cta")}</a></td></tr></table></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:${C.muted};padding-bottom:24px">${pick("If the button doesn't work, copy this link into your browser:", "Se o botão não funcionar, copie este link no navegador:")}<br><a href="${t.action}" style="color:${C.primary};word-break:break-all">${t.action}</a></td></tr>`
    : `<tr><td style="padding:8px 0 28px"><div style="display:inline-block;padding:14px 24px;background:${C.soft};border:1px solid ${C.border};border-radius:8px;font-family:Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:${C.ink}">{{ .Token }}</div></td></tr>`;
  return `${LANG}<!doctype html>
<html lang="{{ if $pt }}pt-BR{{ else }}en{{ end }}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${p("subject")}</title></head>
<body style="margin:0;padding:0;background:${C.sand};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${p("preheader")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sand}"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="36" valign="middle" style="width:36px"><img src="${LOGO_URL}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border:0;outline:none;text-decoration:none"></td>
<td valign="middle" style="padding-left:10px;font-size:20px;font-weight:700;letter-spacing:-.02em;color:${C.ink}">Dinequora</td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid ${C.border};border-radius:12px;padding:36px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.02em;color:${C.ink};padding-bottom:12px">${p("heading")}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:${C.body};padding-bottom:20px">${p("body")}</td></tr>
${action}
<tr><td style="border-top:1px solid ${C.border};padding-top:18px;font-size:12px;line-height:1.6;color:${C.muted}">${p("footer")}</td></tr>
</table></td></tr>
<tr><td align="center" style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:${C.muted}">Dinequora &middot; ${pick("Restaurant operations in one place", "A operação do restaurante em um só lugar")}<br>${pick("Questions?", "Dúvidas?")} <a href="mailto:${SUPPORT}" style="color:${C.muted}">${SUPPORT}</a></td></tr>
</table></td></tr></table>
</body></html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const subjects = {};
  for (const [name, t] of Object.entries(TEMPLATES)) {
    fs.writeFileSync(path.join(OUT_DIR, `${name}.html`), htmlTemplate(t));
    subjects[name] = subjectTemplate(t);
  }
  fs.writeFileSync(path.join(OUT_DIR, "subjects.json"), `${JSON.stringify(subjects, null, 2)}\n`);
  console.log(`wrote ${Object.keys(TEMPLATES).length} templates to supabase/templates`);
}
