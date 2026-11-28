import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  billingEmailKind,
  emailLang,
  escapeHtml,
  renderBillingEmail,
} from "@/lib/email/billing-emails";
import {
  BILLING_REPLY_TO,
  DEFAULT_BILLING_FROM,
  notifyBillingChange,
} from "@/lib/stripe/billing-notify";
import { handleStripeWebhook, type BillingUpdate } from "@/lib/stripe/billing-webhook";
import { stripeSignature } from "@/lib/stripe/stripe-api";

/**
 * Billing e-mails (src/lib/email/billing-emails.ts, src/lib/stripe/billing-notify.ts): the owners
 * hear about activation, a failed renewal and cancellation, once per Stripe event.
 */
const ORG = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const APP = "https://app.dinequora.com";
const data = {
  orgName: "Teste Dinequora",
  planName: "Starter",
  amountCents: 6900,
  currency: "usd",
  appUrl: APP,
};

const update = (over: Partial<BillingUpdate> = {}): BillingUpdate => ({
  _event_id: "evt_1",
  _type: "checkout.session.completed",
  _org_id: ORG,
  _customer: "cus_1",
  _subscription: "sub_1",
  _status: null,
  _plan: "starter",
  _period_start: null,
  _period_end: null,
  _cancel_at_period_end: null,
  _amount_cents: null,
  _currency: null,
  ...over,
});

describe("which e-mail an event sends", () => {
  it("maps only activation, failed payment and cancellation", () => {
    expect(billingEmailKind({ _type: "checkout.session.completed" })).toBe("activated");
    expect(billingEmailKind({ _type: "invoice.payment_failed" })).toBe("payment_failed");
    expect(billingEmailKind({ _type: "customer.subscription.deleted" })).toBe("canceled");
    for (const t of [
      "invoice.paid",
      "customer.subscription.created",
      "customer.subscription.updated",
    ])
      expect(billingEmailKind({ _type: t })).toBeNull();
  });

  it("picks Portuguese for pt-* only", () => {
    expect(emailLang("pt-BR")).toBe("pt");
    expect(emailLang("PT")).toBe("pt");
    expect(emailLang("en-US")).toBe("en");
    expect(emailLang(undefined)).toBe("en");
    expect(emailLang(42)).toBe("en");
  });
});

describe("rendering", () => {
  it("activation in English shows plan, price and the billing link", () => {
    const m = renderBillingEmail("activated", "en", data);
    expect(m.subject).toBe("Your Dinequora Starter plan is active");
    expect(m.html).toContain(
      "Teste Dinequora is now on the Dinequora Starter plan ($69.00/month).",
    );
    expect(m.html).toContain(`href="${APP}/settings/billing"`);
    expect(m.html).toContain("dinequora-mark.png");
    expect(m.html).toContain('lang="en"');
    expect(m.text).toContain(`Open billing: ${APP}/settings/billing`);
  });

  it("activation in Portuguese", () => {
    const m = renderBillingEmail("activated", "pt", data);
    expect(m.subject).toBe("Seu plano Dinequora Starter está ativo");
    expect(m.html).toContain("US$");
    expect(m.html).toContain("/mês");
    expect(m.html).toContain('lang="pt-BR"');
  });

  it("failed payment and cancellation", () => {
    const f = renderBillingEmail("payment_failed", "pt", { ...data, amountCents: 21800 });
    expect(f.subject).toBe("Pagamento recusado na sua assinatura Dinequora");
    expect(f.text).toMatch(/O pagamento de US\$\s?218,00 do plano Starter de Teste Dinequora/);
    const c = renderBillingEmail("canceled", "en", { ...data, amountCents: null });
    expect(c.subject).toBe("Your Dinequora subscription was canceled");
    expect(c.text).toContain("The Starter plan of Teste Dinequora has been canceled");
  });

  it("leaves out the amount when unknown", () => {
    const m = renderBillingEmail("activated", "en", { ...data, amountCents: null });
    expect(m.text).toContain("on the Dinequora Starter plan.");
  });

  it("escapes the restaurant name in HTML and keeps it literal in text", () => {
    const m = renderBillingEmail("activated", "en", { ...data, orgName: `<b>Joe's</b> $& Co` });
    expect(m.html).not.toContain("<b>Joe");
    expect(m.html).toContain(escapeHtml(`<b>Joe's</b> $& Co`));
    expect(m.text).toContain(`<b>Joe's</b> $& Co is now`);
  });
});

/** Minimal service-role client: the tables and the auth admin call notify reads. */
function fakeAdmin({
  owners = [
    { id: "u1", email: "owner@example.com", lang: "pt-BR" },
    { id: "u2", email: "partner@example.com", lang: "en-US" },
  ],
}: { owners?: { id: string; email: string | null; lang: string }[] } = {}) {
  const rows: Record<string, unknown> = {
    organizations: { name: "Teste Dinequora" },
    organization_members: owners.map((o) => ({ user_id: o.id })),
    subscriptions: { plan_id: "starter" },
    billing_plans: { name: "Starter", monthly_price_cents: 6900, currency: "usd" },
  };
  const filters: Record<string, [string, unknown][]> = {};
  const from = (table: string) => {
    filters[table] = [];
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        filters[table]!.push([col, val]);
        return q;
      },
      maybeSingle: async () => ({ data: rows[table], error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows[table], error: null }),
    };
    return q;
  };
  const getUserById = vi.fn(async (id: string) => {
    const o = owners.find((x) => x.id === id)!;
    return {
      data: { user: { id, email: o.email, user_metadata: { preferred_language: o.lang } } },
      error: null,
    };
  });
  const admin = { from, auth: { admin: { getUserById } } } as unknown as SupabaseClient<Database>;
  return { admin, filters };
}

const okFetch = () =>
  vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;

describe("notifyBillingChange", () => {
  const env = { RESEND_API_KEY: "re_test_key" };

  it("does nothing without the e-mail key or for events without an e-mail", async () => {
    const { admin } = fakeAdmin();
    const f = okFetch();
    expect(await notifyBillingChange(admin, update(), APP, {}, f)).toEqual({
      status: "skipped",
      reason: "not_configured",
    });
    expect(
      await notifyBillingChange(admin, update({ _type: "invoice.paid" }), APP, env, f),
    ).toEqual({
      status: "skipped",
      reason: "no_email_for_event",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("e-mails every owner of the organization in their language, once per event", async () => {
    const { admin, filters } = fakeAdmin();
    const f = okFetch();
    const r = await notifyBillingChange(admin, update(), APP, env, f);
    expect(r).toEqual({ status: "sent", kind: "activated", sent: 2, failed: 0 });
    expect(filters["organization_members"]).toEqual([
      ["org_id", ORG],
      ["role", "owner"],
    ]);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual([
      "https://api.resend.com/emails",
      "https://api.resend.com/emails",
    ]);
    const [pt, en] = calls.map((c) => JSON.parse(String(c[1].body)));
    expect(pt).toMatchObject({
      from: DEFAULT_BILLING_FROM,
      to: ["owner@example.com"],
      reply_to: BILLING_REPLY_TO,
      subject: "Seu plano Dinequora Starter está ativo",
    });
    expect(en.subject).toBe("Your Dinequora Starter plan is active");
    const headers = calls.map((c) => c[1].headers as Record<string, string>);
    expect(headers[0]!["Idempotency-Key"]).toBe("evt_1/u1");
    expect(headers[1]!["Idempotency-Key"]).toBe("evt_1/u2");
    expect(headers[0]!["Authorization"]).toBe("Bearer re_test_key");
  });

  it("uses the failed invoice amount and counts provider errors", async () => {
    const { admin } = fakeAdmin({ owners: [{ id: "u1", email: "owner@example.com", lang: "en" }] });
    const f = vi.fn(async () => new Response("{}", { status: 422 })) as unknown as typeof fetch &
      ReturnType<typeof vi.fn>;
    const r = await notifyBillingChange(
      admin,
      update({ _type: "invoice.payment_failed", _amount_cents: 6900, _currency: "usd" }),
      APP,
      env,
      f,
    );
    expect(r).toEqual({ status: "sent", kind: "payment_failed", sent: 0, failed: 1 });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.text).toContain("The payment of $69.00 for the Starter plan of Teste Dinequora");
  });

  it("skips owners without an e-mail and reports no owners", async () => {
    const { admin } = fakeAdmin({ owners: [{ id: "u1", email: null, lang: "en" }] });
    expect(await notifyBillingChange(admin, update(), APP, env, okFetch())).toEqual({
      status: "skipped",
      reason: "no_owners",
    });
  });
});

describe("webhook → notify", () => {
  const SECRET = "whsec_test_secret";
  const NOW = 1_800_000_000_000;
  const body = JSON.stringify({
    id: "evt_9",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: ORG, metadata: { org_id: ORG, plan_id: "starter" } } },
  });
  const req = async () =>
    new Request(`${APP}/api/public/stripe-webhook`, {
      method: "POST",
      headers: {
        "stripe-signature": `t=${NOW / 1000},v1=${await stripeSignature(body, NOW / 1000, SECRET)}`,
      },
      body,
    });

  it("notifies after a first apply only, and a notify error still answers 200", async () => {
    const notify = vi.fn(async () => {
      throw new Error("provider down");
    });
    const first = await handleStripeWebhook(await req(), {
      secret: SECRET,
      apply: async () => true,
      notify,
      now: NOW,
    });
    expect(first.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0] as unknown as [BillingUpdate])[0]).toMatchObject({
      _event_id: "evt_9",
      _type: "checkout.session.completed",
    });
    const dup = await handleStripeWebhook(await req(), {
      secret: SECRET,
      apply: async () => false,
      notify,
      now: NOW,
    });
    expect(await dup.json()).toEqual({ received: true, duplicate: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the database refuses", async () => {
    const notify = vi.fn();
    const res = await handleStripeWebhook(await req(), {
      secret: SECRET,
      apply: async () => {
        throw new Error("db");
      },
      notify,
      now: NOW,
    });
    expect(res.status).toBe(500);
    expect(notify).not.toHaveBeenCalled();
  });
});
