import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  billingEmailKind,
  emailLang,
  renderBillingEmail,
  type BillingEmailKind,
} from "@/lib/email/billing-emails";
import type { BillingUpdate } from "./billing-webhook";

/**
 * Server-only: e-mails the organization's owners after the Stripe webhook applied an event
 * (src/server.ts). Loaded only in builds that include Stripe (build-flags.ts).
 *
 * Off unless the Worker has the e-mail provider key (Resend). Never fails the webhook: the database
 * already applied the event, and a retried event is a duplicate that sends nothing, so an error here
 * is reported and dropped. Resend's Idempotency-Key (event id + owner) keeps a repeat from sending twice.
 */
export const DEFAULT_BILLING_FROM = "Dinequora <billing@send.dinequora.com>";
export const BILLING_REPLY_TO = "billing@dinequora.com";
const RESEND_URL = "https://api.resend.com/emails";

export type NotifyResult =
  | { status: "skipped"; reason: "no_email_for_event" | "not_configured" | "no_owners" }
  | { status: "sent"; kind: BillingEmailKind; sent: number; failed: number };

type Owner = { id: string; email: string; lang: "en" | "pt" };

async function loadContext(admin: SupabaseClient<Database>, update: BillingUpdate) {
  const [org, members, sub] = await Promise.all([
    admin.from("organizations").select("name").eq("id", update._org_id).maybeSingle(),
    admin
      .from("organization_members")
      .select("user_id")
      .eq("org_id", update._org_id)
      .eq("role", "owner"),
    admin.from("subscriptions").select("plan_id").eq("org_id", update._org_id).maybeSingle(),
  ]);
  if (org.error || members.error || sub.error) throw new Error("billing_notify_lookup_failed");
  const planId = update._plan ?? sub.data?.plan_id ?? null;
  const plan = planId
    ? await admin
        .from("billing_plans")
        .select("name, monthly_price_cents, currency")
        .eq("id", planId)
        .maybeSingle()
    : null;
  if (plan?.error) throw new Error("billing_notify_lookup_failed");

  const owners: Owner[] = [];
  for (const m of members.data ?? []) {
    const { data, error } = await admin.auth.admin.getUserById(m.user_id);
    const email = data.user?.email;
    if (error || !email) continue;
    owners.push({
      id: m.user_id,
      email,
      lang: emailLang(data.user?.user_metadata?.["preferred_language"]),
    });
  }
  return {
    orgName: org.data?.name ?? "",
    planName: plan?.data?.name ?? planId ?? "",
    monthlyCents: plan?.data?.monthly_price_cents ?? null,
    planCurrency: plan?.data?.currency ?? "usd",
    owners,
  };
}

export async function notifyBillingChange(
  admin: SupabaseClient<Database>,
  update: BillingUpdate,
  appUrl: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<NotifyResult> {
  const kind = billingEmailKind(update);
  if (!kind) return { status: "skipped", reason: "no_email_for_event" };
  const key = env["RESEND_API_KEY"]?.trim();
  if (!key) return { status: "skipped", reason: "not_configured" };

  const ctx = await loadContext(admin, update);
  if (ctx.owners.length === 0) return { status: "skipped", reason: "no_owners" };
  const amountCents = kind === "activated" ? ctx.monthlyCents : update._amount_cents;
  const currency = (kind === "activated" ? ctx.planCurrency : update._currency) ?? "usd";
  const from = env["BILLING_EMAIL_FROM"]?.trim() || DEFAULT_BILLING_FROM;

  let sent = 0;
  let failed = 0;
  for (const owner of ctx.owners) {
    const mail = renderBillingEmail(kind, owner.lang, {
      orgName: ctx.orgName,
      planName: ctx.planName,
      amountCents,
      currency,
      appUrl,
    });
    try {
      const res = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `${update._event_id}/${owner.id}`,
        },
        body: JSON.stringify({
          from,
          to: [owner.email],
          reply_to: BILLING_REPLY_TO,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { status: "sent", kind, sent, failed };
}
