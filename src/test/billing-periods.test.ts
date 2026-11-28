import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { periodFromRecurring, periodPriceCents, periodSavingsCents } from "@/lib/billing-periods";
import { mapStripeEvent } from "@/lib/stripe/billing-webhook";
import { startCheckoutForOwner } from "@/lib/stripe/billing-server";
import { buildCheckoutParams, subscriptionLookupKey } from "@/lib/stripe/checkout-params";
import { renderBillingEmail } from "@/lib/email/billing-emails";
import { PLANS, RECURRING, lookupKeys } from "../../scripts/stripe/setup-catalog.mjs";
import { PRICES, periodPrice } from "../../website/src/config/pricing";

/**
 * Billing periods (migration 0048, the website's pricing): monthly, every 6 months (8% off) and
 * yearly (15% off), the longer periods paid upfront; the implementation fee is never discounted.
 */
const ORG = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const starter = {
  monthly_price_cents: 6900,
  semiannual_price_cents: 38100,
  annual_price_cents: 70400,
};

describe("period prices", () => {
  it("picks the period's price and the savings against paying monthly", () => {
    expect(periodPriceCents(starter, "monthly")).toBe(6900);
    expect(periodPriceCents(starter, "semiannual")).toBe(38100);
    expect(periodPriceCents(starter, "annual")).toBe(70400);
    expect(periodSavingsCents(starter, "monthly")).toBe(0);
    expect(periodSavingsCents(starter, "semiannual")).toBe(6900 * 6 - 38100);
    expect(periodSavingsCents(starter, "annual")).toBe(6900 * 12 - 70400);
    expect(periodPriceCents({ monthly_price_cents: null }, "annual")).toBeNull();
  });

  it("maps Stripe's recurring interval to the period", () => {
    expect(periodFromRecurring("month", 1)).toBe("monthly");
    expect(periodFromRecurring("month", 6)).toBe("semiannual");
    expect(periodFromRecurring("year", 1)).toBe("annual");
    expect(periodFromRecurring("week", 1)).toBeNull();
    expect(periodFromRecurring("month", 3)).toBeNull();
  });

  it("the Stripe catalog and 0048 carry the website's prices", () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, "../../drizzle/migrations/0048_billing_periods.sql"),
      "utf8",
    );
    for (const p of PLANS) {
      const m = new RegExp(
        `semiannual_price_cents = (\\d+), annual_price_cents = (\\d+) WHERE id = '${p.id}'`,
      ).exec(sql);
      expect(m, p.id).not.toBeNull();
      expect([Number(m![1]), Number(m![2])]).toEqual([p.semiannual, p.annual]);
      const site = PRICES[p.id as "starter" | "growth"].monthlyUsd;
      expect(p.monthly).toBe(site * 100);
      expect(p.semiannual).toBe(periodPrice(site, "semiannual").charge * 100);
      expect(p.annual).toBe(periodPrice(site, "annual").charge * 100);
    }
  });

  it("uses one lookup key per plan and period, the same in checkout and the catalog", () => {
    for (const p of PLANS)
      for (const period of ["monthly", "semiannual", "annual"] as const)
        expect(subscriptionLookupKey(p.id, period)).toBe(lookupKeys(p.id)[period]);
    expect(RECURRING.semiannual).toEqual({ interval: "month", interval_count: 6 });
    expect(RECURRING.annual).toEqual({ interval: "year", interval_count: 1 });
  });
});

describe("checkout and webhook carry the period", () => {
  it("checkout tags the session and the subscription with the period", () => {
    const p = buildCheckoutParams({
      orgId: ORG,
      planId: "growth",
      period: "annual",
      subscriptionPriceId: "price_y",
      implementationPriceId: "price_i",
      customerId: null,
      email: null,
      origin: "https://app.dinequora.com",
    });
    expect(p.line_items[0]).toEqual({ price: "price_y", quantity: 1 });
    expect(p.metadata).toEqual({ org_id: ORG, plan_id: "growth", billing_period: "annual" });
    expect(p.subscription_data.metadata.billing_period).toBe("annual");
  });

  const ev = (type: string, object: object) => ({ id: "evt_p", type, data: { object } });
  const period = (e: unknown) => {
    const m = mapStripeEvent(e);
    if (m.kind !== "apply") throw new Error("ignored");
    return m.update._billing_period;
  };

  it("reads the checkout's metadata", () => {
    expect(
      period(
        ev("checkout.session.completed", {
          client_reference_id: ORG,
          metadata: { org_id: ORG, plan_id: "starter", billing_period: "semiannual" },
        }),
      ),
    ).toBe("semiannual");
  });

  it("trusts the subscription price's interval over stale metadata", () => {
    expect(
      period(
        ev("customer.subscription.updated", {
          id: "sub_1",
          status: "active",
          metadata: { org_id: ORG, billing_period: "monthly" },
          items: { data: [{ price: { recurring: { interval: "year", interval_count: 1 } } }] },
        }),
      ),
    ).toBe("annual");
  });

  it("reads invoices, and drops a period we do not sell", () => {
    expect(
      period(
        ev("invoice.paid", {
          amount_paid: 70400,
          parent: { subscription_details: { metadata: { org_id: ORG, billing_period: "annual" } } },
        }),
      ),
    ).toBe("annual");
    expect(
      period(
        ev("customer.subscription.updated", {
          id: "sub_1",
          metadata: { org_id: ORG, billing_period: "weekly" },
        }),
      ),
    ).toBeNull();
  });
});

describe("startCheckoutForOwner by period", () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_1" };
  const plans: Record<string, object> = {
    starter: {
      id: "starter",
      ...starter,
      implementation_fee_cents: 14900,
      implementation_fee_is_minimum: false,
      active: true,
    },
    enterprise: {
      id: "enterprise",
      monthly_price_cents: null,
      semiannual_price_cents: null,
      annual_price_cents: null,
      implementation_fee_cents: 79900,
      implementation_fee_is_minimum: true,
      active: true,
    },
  };
  const client = () => {
    const from = (table: string) => {
      let id = "";
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => {
          id = v;
          return q;
        },
        maybeSingle: async () =>
          table === "billing_plans"
            ? { data: plans[id] ?? null, error: null }
            : {
                data: {
                  plan_id: "starter",
                  status: "trialing",
                  stripe_customer_id: null,
                  stripe_subscription_id: null,
                },
                error: null,
              },
      };
      return q;
    };
    return {
      rpc: async () => ({ data: true, error: null }),
      from,
      auth: { getUser: async () => ({ data: { user: { email: "owner@example.com" } } }) },
    } as unknown as Parameters<typeof startCheckoutForOwner>[0];
  };
  const stripeFetch = (amounts: Record<string, number>) =>
    vi.fn(async (url: string) =>
      String(url).includes("/v1/prices")
        ? new Response(
            JSON.stringify({
              data: Object.entries(amounts).map(([k, a], i) => ({
                id: `price_${i}`,
                lookup_key: k,
                unit_amount: a,
              })),
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/x" }), { status: 200 }),
    );
  const run = (planId: string, p: "monthly" | "semiannual" | "annual") =>
    startCheckoutForOwner(
      client(),
      { orgId: ORG, planId, period: p },
      "https://app.dinequora.com",
      env,
    );

  it("charges the yearly price when the owner picks yearly", async () => {
    const f = stripeFetch({
      dinequora_starter_annual: 70400,
      dinequora_starter_implementation: 14900,
    });
    vi.stubGlobal("fetch", f);
    try {
      expect(await run("starter", "annual")).toEqual({
        status: "redirect",
        url: "https://checkout.stripe.com/c/x",
      });
      const calls = f.mock.calls as unknown as [string, RequestInit | undefined][];
      expect(decodeURIComponent(calls[0]![0])).toContain("lookup_keys[0]=dinequora_starter_annual");
      expect(decodeURIComponent(String(calls[1]![1]?.body))).toContain(
        "metadata[billing_period]=annual",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses when Stripe's yearly price is not the app's, or the plan has no such period", async () => {
    vi.stubGlobal(
      "fetch",
      stripeFetch({ dinequora_starter_annual: 69900, dinequora_starter_implementation: 14900 }),
    );
    try {
      expect(await run("starter", "annual")).toEqual({ status: "plan_unavailable" });
      expect(await run("enterprise", "semiannual")).toEqual({ status: "plan_unavailable" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("e-mails by period", () => {
  const d = {
    orgName: "Teste Dinequora",
    planName: "Starter",
    currency: "usd",
    appUrl: "https://app.dinequora.com",
  };
  it("activation says the period's price and when it renews", () => {
    const en = renderBillingEmail("activated", "en", {
      ...d,
      amountCents: 70400,
      period: "annual",
    });
    expect(en.text).toContain("on the Dinequora Starter plan ($704.00/year).");
    expect(en.text).toContain("renews automatically every year.");
    const pt = renderBillingEmail("activated", "pt", {
      ...d,
      amountCents: 38100,
      period: "semiannual",
    });
    expect(pt.text).toMatch(/plano Dinequora Starter \(US\$\s?381,00 a cada 6 meses\)\./);
    expect(pt.text).toContain("renova automaticamente a cada 6 meses.");
    const monthly = renderBillingEmail("activated", "en", { ...d, amountCents: 6900 });
    expect(monthly.text).toContain("($69.00/month)");
    expect(monthly.text).toContain("each month");
  });
});
