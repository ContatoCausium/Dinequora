/**
 * Billing e-mails sent by the app to the organization's owners when the Stripe webhook changes the
 * subscription (src/lib/stripe/billing-notify.ts). Pure rendering: no network, no environment.
 *
 * Same look as the Auth e-mails (scripts/email/build-auth-templates.mjs: colors, logo, footer).
 * Monthly receipts are not sent here: Stripe sends them in live mode (Settings > Customer emails).
 */
import type { BillingUpdate } from "@/lib/stripe/billing-webhook";

export type BillingEmailKind = "activated" | "payment_failed" | "canceled";
export type EmailLang = "en" | "pt";

/**
 * Which e-mail an applied event sends, by event type so each fires once per Stripe event:
 * - checkout.session.completed: the subscription was just bought (once per checkout);
 * - invoice.payment_failed: a renewal charge failed (Stripe retries; each attempt is a new event);
 * - customer.subscription.deleted: the subscription ended.
 */
export function billingEmailKind(update: Pick<BillingUpdate, "_type">): BillingEmailKind | null {
  switch (update._type) {
    case "checkout.session.completed":
      return "activated";
    case "invoice.payment_failed":
      return "payment_failed";
    case "customer.subscription.deleted":
      return "canceled";
    default:
      return null;
  }
}

/** pt-BR (or any pt) from the sign-up metadata gets Portuguese; everyone else English. */
export function emailLang(preferred: unknown): EmailLang {
  return typeof preferred === "string" && preferred.toLowerCase().startsWith("pt") ? "pt" : "en";
}

const C = {
  primary: "#b5452a",
  ink: "#1d1713",
  body: "#4a433e",
  muted: "#68625d",
  border: "#e5e2df",
  sand: "#f2f0ec",
};
const SUPPORT = "support@dinequora.com";
export const BILLING_LOGO_URL = "https://app.dinequora.com/email/dinequora-mark.png";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatMoney(cents: number, currency: string, lang: EmailLang): string {
  return new Intl.NumberFormat(lang === "pt" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export type BillingEmailData = {
  orgName: string;
  planName: string;
  /** Plan monthly price (activated) or the failed invoice amount (payment_failed). */
  amountCents: number | null;
  currency: string;
  /** Origin of the app, e.g. https://app.dinequora.com. */
  appUrl: string;
};

type Copy = {
  subject: string;
  preheader: string;
  heading: string;
  /** Paragraphs; {org} {plan} {amount} are replaced (HTML-escaped in the HTML version). */
  body: string[];
  cta: string;
};

const COPY: Record<BillingEmailKind, Record<EmailLang, Copy>> = {
  activated: {
    en: {
      subject: "Your Dinequora {plan} plan is active",
      preheader: "Thanks for subscribing. Your plan is ready to use.",
      heading: "Your plan is active",
      body: [
        "Thanks for subscribing. {org} is now on the Dinequora {plan} plan{amount}.",
        "The subscription renews automatically each month. You can see invoices, update your card or cancel anytime in Billing.",
      ],
      cta: "Open billing",
    },
    pt: {
      subject: "Seu plano Dinequora {plan} está ativo",
      preheader: "Obrigado por assinar. Seu plano já está pronto para uso.",
      heading: "Seu plano está ativo",
      body: [
        "Obrigado por assinar. {org} agora está no plano Dinequora {plan}{amount}.",
        "A assinatura renova automaticamente todo mês. Você pode ver as faturas, trocar o cartão ou cancelar quando quiser em Cobrança.",
      ],
      cta: "Abrir cobrança",
    },
  },
  payment_failed: {
    en: {
      subject: "Payment failed for your Dinequora subscription",
      preheader: "Update your card to keep your plan active.",
      heading: "We couldn't charge your card",
      body: [
        "The payment{amount} for the {plan} plan of {org} didn't go through.",
        "Update your payment method in Billing to keep your plan active. We'll try the charge again automatically.",
      ],
      cta: "Update payment method",
    },
    pt: {
      subject: "Pagamento recusado na sua assinatura Dinequora",
      preheader: "Atualize o cartão para manter seu plano ativo.",
      heading: "Não conseguimos cobrar seu cartão",
      body: [
        "O pagamento{amount} do plano {plan} de {org} não foi aprovado.",
        "Atualize a forma de pagamento em Cobrança para manter seu plano ativo. Vamos tentar a cobrança de novo automaticamente.",
      ],
      cta: "Atualizar forma de pagamento",
    },
  },
  canceled: {
    en: {
      subject: "Your Dinequora subscription was canceled",
      preheader: "Your {plan} plan has ended.",
      heading: "Your subscription was canceled",
      body: [
        "The {plan} plan of {org} has been canceled and will no longer be charged.",
        "If this was a mistake or you want to come back, you can subscribe again in Billing.",
      ],
      cta: "Open billing",
    },
    pt: {
      subject: "Sua assinatura Dinequora foi cancelada",
      preheader: "Seu plano {plan} foi encerrado.",
      heading: "Sua assinatura foi cancelada",
      body: [
        "O plano {plan} de {org} foi cancelado e não será mais cobrado.",
        "Se foi engano ou se quiser voltar, você pode assinar de novo em Cobrança.",
      ],
      cta: "Abrir cobrança",
    },
  },
};

const FOOTER: Record<EmailLang, string> = {
  en: "You received this email because you are an owner of {org} on Dinequora.",
  pt: "Você recebeu este e-mail porque é dono(a) de {org} no Dinequora.",
};

function amountPhrase(kind: BillingEmailKind, d: BillingEmailData, lang: EmailLang): string {
  if (d.amountCents == null) return "";
  const money = formatMoney(d.amountCents, d.currency, lang);
  if (kind === "activated") return lang === "pt" ? ` (${money}/mês)` : ` (${money}/month)`;
  return lang === "pt" ? ` de ${money}` : ` of ${money}`;
}

export type RenderedEmail = { subject: string; html: string; text: string };

export function renderBillingEmail(
  kind: BillingEmailKind,
  lang: EmailLang,
  d: BillingEmailData,
): RenderedEmail {
  const c = COPY[kind][lang];
  const amount = amountPhrase(kind, d, lang);
  // Function replacers: a "$&" in a restaurant name must stay literal.
  const fill = (s: string, esc: (v: string) => string) =>
    s
      .replace("{org}", () => esc(d.orgName))
      .replace("{plan}", () => esc(d.planName))
      .replace("{amount}", () => esc(amount));
  const plain = (s: string) => s;
  const link = `${d.appUrl.replace(/\/+$/, "")}/settings/billing`;
  const subject = fill(c.subject, plain);
  const footer = fill(FOOTER[lang], escapeHtml);
  const paragraphs = c.body
    .map(
      (p) =>
        `<tr><td style="font-size:15px;line-height:1.6;color:${C.body};padding-bottom:16px">${fill(p, escapeHtml)}</td></tr>`,
    )
    .join("\n");
  const tagline =
    lang === "pt"
      ? "A operação do restaurante em um só lugar"
      : "Restaurant operations in one place";
  const questions = lang === "pt" ? "Dúvidas?" : "Questions?";
  const fallback =
    lang === "pt"
      ? "Se o botão não funcionar, copie este link no navegador:"
      : "If the button doesn't work, copy this link into your browser:";

  const html = `<!doctype html>
<html lang="${lang === "pt" ? "pt-BR" : "en"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.sand};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${fill(c.preheader, escapeHtml)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sand}"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="36" valign="middle" style="width:36px"><img src="${BILLING_LOGO_URL}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border:0;outline:none;text-decoration:none"></td>
<td valign="middle" style="padding-left:10px;font-size:20px;font-weight:700;letter-spacing:-.02em;color:${C.ink}">Dinequora</td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid ${C.border};border-radius:12px;padding:36px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.02em;color:${C.ink};padding-bottom:12px">${escapeHtml(c.heading)}</td></tr>
${paragraphs}
<tr><td style="padding:8px 0 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${C.primary}"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(c.cta)}</a></td></tr></table></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:${C.muted};padding-bottom:24px">${fallback}<br><a href="${escapeHtml(link)}" style="color:${C.primary};word-break:break-all">${escapeHtml(link)}</a></td></tr>
<tr><td style="border-top:1px solid ${C.border};padding-top:18px;font-size:12px;line-height:1.6;color:${C.muted}">${footer}</td></tr>
</table></td></tr>
<tr><td align="center" style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:${C.muted}">Dinequora &middot; ${tagline}<br>${questions} <a href="mailto:${SUPPORT}" style="color:${C.muted}">${SUPPORT}</a></td></tr>
</table></td></tr></table>
</body></html>
`;

  const text = [
    c.heading,
    "",
    ...c.body.map((p) => fill(p, plain)),
    "",
    `${c.cta}: ${link}`,
    "",
    fill(FOOTER[lang], plain),
    `${questions} ${SUPPORT}`,
  ].join("\n");

  return { subject, html, text };
}
