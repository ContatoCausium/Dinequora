/**
 * Branded, bilingual email templates — PREPARED ONLY.
 * Nothing in the app sends these yet: sending requires a verified sender domain and an email provider.
 * Renders plain HTML + text so any provider (or the backend auth email hook) can use them.
 */
export type EmailKind =
  "confirm_account" | "password_reset" | "invitation" | "invitation_accepted" | "security_notice";
export type EmailLang = "en-US" | "pt-BR";
export type EmailVars = {
  orgName?: string;
  brandColor?: string;
  actionUrl?: string;
  inviterName?: string;
  memberName?: string;
  role?: string;
  detail?: string;
};

type Copy = { subject: string; heading: string; body: string; cta?: string; footer: string };

const COPY: Record<EmailLang, Record<EmailKind, (v: EmailVars) => Copy>> = {
  "en-US": {
    confirm_account: () => ({
      subject: "Confirm your Dinequora account",
      heading: "Confirm your email",
      body: "Tap the button below to confirm your email address and finish creating your account.",
      cta: "Confirm email",
      footer: "If you didn't create an account, you can ignore this email.",
    }),
    password_reset: () => ({
      subject: "Reset your Dinequora password",
      heading: "Reset your password",
      body: "We received a request to reset your password. This link expires in 1 hour and can be used once.",
      cta: "Choose a new password",
      footer: "If you didn't request this, your password stays the same.",
    }),
    invitation: (v) => ({
      subject: `You're invited to ${v.orgName ?? "a restaurant"} on Dinequora`,
      heading: `Join ${v.orgName ?? "the team"}`,
      body: `${v.inviterName ?? "A manager"} invited you to join as ${v.role ?? "a team member"}. Accept with this same email address. The invitation expires in 7 days.`,
      cta: "Accept invitation",
      footer: "If you weren't expecting this, you can ignore it.",
    }),
    invitation_accepted: (v) => ({
      subject: `${v.memberName ?? "Someone"} joined ${v.orgName ?? "your organization"}`,
      heading: "Invitation accepted",
      body: `${v.memberName ?? "Your invitee"} now has ${v.role ?? "member"} access to ${v.orgName ?? "your organization"}.`,
      footer: "You can review access anytime in Team & access.",
    }),
    security_notice: (v) => ({
      subject: "Security notice for your Dinequora account",
      heading: "A security-related change was made",
      body: v.detail ?? "A sensitive change was made to your account.",
      footer:
        "If this wasn't you, reset your password right away and contact your organization owner.",
    }),
  },
  "pt-BR": {
    confirm_account: () => ({
      subject: "Confirme sua conta Dinequora",
      heading: "Confirme seu e-mail",
      body: "Toque no botão abaixo para confirmar seu e-mail e concluir a criação da conta.",
      cta: "Confirmar e-mail",
      footer: "Se você não criou uma conta, ignore este e-mail.",
    }),
    password_reset: () => ({
      subject: "Redefina sua senha Dinequora",
      heading: "Redefinir senha",
      body: "Recebemos um pedido para redefinir sua senha. Este link expira em 1 hora e pode ser usado uma vez.",
      cta: "Escolher nova senha",
      footer: "Se você não pediu isso, sua senha continua a mesma.",
    }),
    invitation: (v) => ({
      subject: `Você foi convidado para ${v.orgName ?? "um restaurante"} no Dinequora`,
      heading: `Entre para ${v.orgName ?? "a equipe"}`,
      body: `${v.inviterName ?? "Um gerente"} convidou você como ${v.role ?? "membro da equipe"}. Aceite com este mesmo e-mail. O convite expira em 7 dias.`,
      cta: "Aceitar convite",
      footer: "Se você não esperava este convite, pode ignorá-lo.",
    }),
    invitation_accepted: (v) => ({
      subject: `${v.memberName ?? "Alguém"} entrou em ${v.orgName ?? "sua organização"}`,
      heading: "Convite aceito",
      body: `${v.memberName ?? "A pessoa convidada"} agora tem acesso como ${v.role ?? "membro"} a ${v.orgName ?? "sua organização"}.`,
      footer: "Revise os acessos a qualquer momento em Equipe e acesso.",
    }),
    security_notice: (v) => ({
      subject: "Aviso de segurança da sua conta Dinequora",
      heading: "Uma alteração de segurança foi feita",
      body: v.detail ?? "Uma alteração sensível foi feita na sua conta.",
      footer:
        "Se não foi você, redefina sua senha imediatamente e fale com o proprietário da organização.",
    }),
  },
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const safeColor = (c?: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#1f2937");
const safeUrl = (u?: string) => (u && /^https:\/\//.test(u) ? u : undefined);

export function renderEmail(kind: EmailKind, lang: EmailLang, vars: EmailVars = {}) {
  const c = COPY[lang][kind](vars);
  const color = safeColor(vars.brandColor);
  const url = safeUrl(vars.actionUrl);
  const brand = esc(vars.orgName ?? "Dinequora");
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#ffffff;font-family:Geist,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:13px;font-weight:600;letter-spacing:.02em;color:${color};padding-bottom:24px">${brand}</td></tr>
<tr><td style="font-size:22px;font-weight:600;letter-spacing:-.01em;padding-bottom:12px">${esc(c.heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#374151;padding-bottom:24px">${esc(c.body)}</td></tr>
${url && c.cta ? `<tr><td style="padding-bottom:28px"><a href="${esc(url)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:8px">${esc(c.cta)}</a></td></tr>` : ""}
<tr><td style="font-size:12px;line-height:1.5;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:16px">${esc(c.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [c.heading, "", c.body, url && c.cta ? `\n${c.cta}: ${url}` : "", "", c.footer].join(
    "\n",
  );
  return { subject: c.subject, html, text };
}
