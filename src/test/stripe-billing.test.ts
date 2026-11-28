import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  formEncode,
  stripeKeyMode,
  stripeSignature,
  verifyStripeSignature,
} from "@/lib/stripe/stripe-api";
import {
  HANDLED_EVENTS,
  handleStripeWebhook,
  mapStripeEvent,
  type BillingUpdate,
} from "@/lib/stripe/billing-webhook";
import { billingMode } from "@/lib/stripe/billing-server";
import {
  buildCheckoutParams,
  implementationLookupKey,
  monthlyLookupKey,
} from "@/lib/stripe/checkout-params";
import { PLANS, WEBHOOK_EVENTS, lookupKeys } from "../../scripts/stripe/setup-catalog.mjs";

/**
 * Stripe Billing (docs/billing-and-entitlements.md): the signed webhook is the only thing that
 * changes a subscription; checkout and portal are owner-only server functions.
 */
const ORG = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const SECRET = "whsec_test_secret";
const NOW = 1_800_000_000_000;

async function signed(body: string, { secret = SECRET, at = NOW / 1000 } = {}) {
  return `t=${at},v1=${await stripeSignature(body, at, secret)}`;
}

describe("stripe api helpers", () => {
  it("form-encodes nested objects and arrays the way Stripe expects", () => {
    expect(
      decodeURIComponent(
        formEncode({
          mode: "subscription",
          line_items: [{ price: "price_1", quantity: 1 }],
          metadata: { org_id: ORG },
          skip: undefined,
          none: null,
        }),
      ),
    ).toBe(
      `mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[org_id]=${ORG}`,
    );
  });

  it("tells test keys from live keys", () => {
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
    expect(stripeKeyMode("pk_test_abc")).toBeNull();
    expect(stripeKeyMode(undefined)).toBeNull();
  });
});

describe("webhook signature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });

  it("accepts Stripe's v1 signature over the raw body", async () => {
    expect(await verifyStripeSignature(body, await signed(body), SECRET, { now: NOW })).toBe(true);
  });

  it("accepts a header with several v1 entries when one matches (secret rotation)", async () => {
    const good = await signed(body);
    const header = `t=${NOW / 1000},v1=${"0".repeat(64)},${good.split(",")[1]}`;
    expect(await verifyStripeSignature(body, header, SECRET, { now: NOW })).toBe(true);
  });

  it.each([
    ["a changed body", async () => [body.replace("evt_1", "evt_2"), await signed(body)]],
    ["another secret", async () => [body, await signed(body, { secret: "whsec_other" })]],
    ["an old timestamp", async () => [body, await signed(body, { at: NOW / 1000 - 301 })]],
    ["no header", async () => [body, null]],
    ["a header without v1", async () => [body, `t=${NOW / 1000}`]],
  ])("refuses %s", async (_label, make) => {
    const [payload, header] = (await make()) as [string, string | null];
    expect(await verifyStripeSignature(payload, header, SECRET, { now: NOW })).toBe(false);
  });
});

describe("stripe events → billing_apply_stripe_event", () => {
  const ev = (type: string, object: object) => ({ id: "evt_9", type, data: { object } });
  const update = (e: unknown) => {
    const m = mapStripeEvent(e);
    if (m.kind !== "apply") throw new Error(`ignored: ${m.reason}`);
    return m.update;
  };

  it("checkout completed records the customer and subscription of the organization", () => {
    expect(
      update(
        ev("checkout.session.completed", {
          customer: "cus_1",
          subscription: "sub_1",
          client_reference_id: ORG,
          metadata: { org_id: ORG, plan_id: "starter" },
        }),
      ),
    ).toMatchObject({
      _org_id: ORG,
      _customer: "cus_1",
      _subscription: "sub_1",
      _plan: "starter",
      _status: null,
      _amount_cents: null,
    });
  });

  it("subscription updated carries status, plan and the period of its item (API basil)", () => {
    expect(
      update(
        ev("customer.subscription.updated", {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: true,
          metadata: { org_id: ORG, plan_id: "growth" },
          items: {
            data: [{ current_period_start: 1_800_000_000, current_period_end: 1_802_592_000 }],
          },
        }),
      ),
    ).toMatchObject({
      _subscription: "sub_1",
      _status: "active",
      _plan: "growth",
      _cancel_at_period_end: true,
      _period_start: new Date(1_800_000_000_000).toISOString(),
      _period_end: new Date(1_802_592_000_000).toISOString(),
    });
  });

  it("reads the period from the subscription itself on older API versions", () => {
    expect(
      update(
        ev("customer.subscription.created", {
          id: "sub_1",
          status: "trialing",
          metadata: { org_id: ORG },
          current_period_end: 1_802_592_000,
        }),
      )._period_end,
    ).toBe(new Date(1_802_592_000_000).toISOString());
  });

  it("subscription deleted cancels", () => {
    expect(
      update(
        ev("customer.subscription.deleted", {
          id: "sub_1",
          status: "canceled",
          metadata: { org_id: ORG },
        }),
      )._status,
    ).toBe("canceled");
  });

  it("invoice paid records the amount and keeps the subscription active", () => {
    expect(
      update(
        ev("invoice.paid", {
          customer: "cus_1",
          amount_paid: 21800,
          currency: "usd",
          parent: {
            subscription_details: {
              subscription: "sub_1",
              metadata: { org_id: ORG, plan_id: "starter" },
            },
          },
        }),
      ),
    ).toMatchObject({
      _status: "active",
      _amount_cents: 21800,
      _currency: "usd",
      _subscription: "sub_1",
    });
  });

  it("a failed invoice starts the grace period (past_due), also with the older invoice shape", () => {
    expect(
      update(
        ev("invoice.payment_failed", {
          amount_due: 6900,
          currency: "usd",
          subscription: "sub_1",
          subscription_details: { metadata: { org_id: ORG } },
        }),
      ),
    ).toMatchObject({ _status: "past_due", _amount_cents: 6900, _subscription: "sub_1" });
  });

  it.each([
    ["an event without organization", ev("invoice.paid", { amount_paid: 1 }), "no_organization"],
    [
      "an organization id that is not a uuid",
      ev("customer.subscription.updated", { metadata: { org_id: "acme" } }),
      "no_organization",
    ],
    ["an event type we do not handle", ev("charge.refunded", {}), "unhandled_type"],
  ])("ignores %s", (_l, e, reason) => {
    expect(mapStripeEvent(e)).toEqual({ kind: "ignore", reason });
  });

  it("the endpoint the setup script registers listens to exactly the handled events", () => {
    expect([...WEBHOOK_EVENTS].sort()).toEqual([...HANDLED_EVENTS].sort());
  });
});

describe("webhook endpoint", () => {
  const body = JSON.stringify({
    id: "evt_5",
    type: "invoice.paid",
    data: {
      object: {
        amount_paid: 6900,
        currency: "usd",
        subscription_details: { metadata: { org_id: ORG } },
      },
    },
  });
  const req = async (header: string | null, method = "POST", payload = body) =>
    new Request("https://app.dinequora.com/api/public/stripe-webhook", {
      method,
      headers: header ? { "stripe-signature": header } : {},
      body: method === "POST" ? payload : null,
    });

  it("applies a verified event once and reports duplicates", async () => {
    const apply = vi
      .fn<(u: BillingUpdate) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const first = await handleStripeWebhook(await req(await signed(body)), {
      secret: SECRET,
      apply,
      now: NOW,
    });
    expect(first.status).toBe(200);
    expect(apply.mock.calls[0]![0]).toMatchObject({
      _event_id: "evt_5",
      _org_id: ORG,
      _amount_cents: 6900,
    });
    const again = await handleStripeWebhook(await req(await signed(body)), {
      secret: SECRET,
      apply,
      now: NOW,
    });
    expect(await again.json()).toEqual({ received: true, duplicate: true });
  });

  it("refuses a bad signature without touching the database", async () => {
    const apply = vi.fn();
    const res = await handleStripeWebhook(await req(await signed(body, { secret: "whsec_x" })), {
      secret: SECRET,
      apply,
      now: NOW,
    });
    expect(res.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers 503 when not configured, 405 for other methods, 200 for events it ignores", async () => {
    const apply = vi.fn();
    expect((await handleStripeWebhook(await req(null), { secret: undefined, apply })).status).toBe(
      503,
    );
    expect(
      (await handleStripeWebhook(await req(null, "GET"), { secret: SECRET, apply })).status,
    ).toBe(405);
    const other = JSON.stringify({ id: "evt_6", type: "charge.refunded", data: { object: {} } });
    const res = await handleStripeWebhook(await req(await signed(other), "POST", other), {
      secret: SECRET,
      apply,
      now: NOW,
    });
    expect(res.status).toBe(200);
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers 500 when the database refuses, so Stripe retries", async () => {
    const apply = vi.fn().mockRejectedValue(new Error("unknown_org"));
    const res = await handleStripeWebhook(await req(await signed(body)), {
      secret: SECRET,
      apply,
      now: NOW,
    });
    expect(res.status).toBe(500);
  });
});

describe("checkout", () => {
  const base = {
    orgId: ORG,
    planId: "starter",
    period: "monthly" as const,
    subscriptionPriceId: "price_m",
    implementation: { price: "price_i" },
    customerId: null,
    email: "owner@example.com",
    origin: "https://app.dinequora.com",
  };

  it("charges the monthly price plus the one-time implementation, tagged with the organization", () => {
    const p = buildCheckoutParams(base);
    expect(p.mode).toBe("subscription");
    expect(p.line_items).toEqual([
      { price: "price_m", quantity: 1 },
      { price: "price_i", quantity: 1 },
    ]);
    expect(p.client_reference_id).toBe(ORG);
    expect(p.subscription_data.metadata).toEqual({
      org_id: ORG,
      plan_id: "starter",
      billing_period: "monthly",
    });
    expect(p).toMatchObject({ customer_email: "owner@example.com" });
    expect(p.success_url).toBe("https://app.dinequora.com/settings/billing?checkout=success");
    expect(p.cancel_url).toBe("https://app.dinequora.com/settings/billing?checkout=canceled");
  });

  it("reuses the organization's Stripe customer, and skips a missing implementation price", () => {
    const p = buildCheckoutParams({ ...base, customerId: "cus_1", implementation: null });
    expect(p).toMatchObject({ customer: "cus_1" });
    expect(p).not.toHaveProperty("customer_email");
    expect(p.line_items).toHaveLength(1);
  });

  it("is off until both Stripe secrets exist, and refuses live keys without the explicit switch", () => {
    expect(billingMode({})).toBe("off");
    expect(billingMode({ STRIPE_SECRET_KEY: "sk_test_1" })).toBe("off");
    expect(billingMode({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_1" })).toBe(
      "test",
    );
    expect(billingMode({ STRIPE_SECRET_KEY: "sk_live_1", STRIPE_WEBHOOK_SECRET: "whsec_1" })).toBe(
      "off",
    );
    expect(
      billingMode({
        STRIPE_SECRET_KEY: "sk_live_1",
        STRIPE_WEBHOOK_SECRET: "whsec_1",
        STRIPE_LIVE_ENABLED: "true",
      }),
    ).toBe("live");
  });
});

describe("stripe catalog", () => {
  it("uses the same lookup keys as checkout", () => {
    for (const p of PLANS) {
      expect(lookupKeys(p.id).monthly).toBe(monthlyLookupKey(p.id));
      expect(lookupKeys(p.id).implementation).toBe(implementationLookupKey(p.id));
    }
  });

  it("has the prices of billing_plans (migration 0047, the website's prices)", () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, "../../drizzle/migrations/0047_plan_prices_from_website.sql"),
      "utf8",
    );
    for (const p of PLANS) {
      const m = new RegExp(
        `monthly_price_cents = (\\d+), implementation_fee_cents = (\\d+)[^;]*WHERE id = '${p.id}'`,
      ).exec(sql);
      expect(m, p.id).not.toBeNull();
      expect([Number(m![1]), Number(m![2])]).toEqual([p.monthly, p.implementation]);
    }
  });
});
