import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyChange, implementationDueCents, parseLookupKey } from "@/lib/billing-changes";
import { buildCheckoutParams } from "@/lib/stripe/checkout-params";
import { mapStripeEvent } from "@/lib/stripe/billing-webhook";
import { billingEmailKind, renderBillingEmail } from "@/lib/email/billing-emails";
import { changePlanForOwner, startCheckoutForOwner } from "@/lib/stripe/billing-server";

/**
 * Plan and period changes (src/lib/billing-changes.ts), rules approved 2026-11-28: longer period
 * now without implementation; bigger plan now with only the implementation difference; smaller plan
 * or shorter period at the end of the paid period; buying again does not repeat the implementation.
 */
const ORG = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("rules", () => {
  const starter = 1;
  const growth = 3;
  it("classifies each change", () => {
    const c = (a: number, ap: "monthly" | "semiannual" | "annual", b: number, bp: typeof ap) =>
      classifyChange({ storeLimit: a, period: ap }, { storeLimit: b, period: bp });
    expect(c(starter, "monthly", starter, "monthly")).toBe("same");
    expect(c(starter, "monthly", starter, "annual")).toBe("now");
    expect(c(starter, "semiannual", starter, "annual")).toBe("now");
    expect(c(starter, "monthly", growth, "monthly")).toBe("now");
    expect(c(starter, "monthly", growth, "annual")).toBe("now");
    expect(c(starter, "annual", starter, "monthly")).toBe("at_period_end");
    expect(c(growth, "monthly", starter, "monthly")).toBe("at_period_end");
    expect(c(growth, "annual", starter, "semiannual")).toBe("at_period_end");
    expect(c(starter, "annual", growth, "monthly")).toBe("contact_support");
    expect(c(growth, "monthly", starter, "annual")).toBe("contact_support");
  });

  it("owes only what was not paid yet", () => {
    expect(implementationDueCents(39999, 14900)).toBe(25099);
    expect(implementationDueCents(14900, 14900)).toBe(0);
    expect(implementationDueCents(14900, 29800)).toBe(0);
    expect(implementationDueCents(14900, 0)).toBe(14900);
  });

  it("reads our lookup keys", () => {
    expect(parseLookupKey("dinequora_growth_annual")).toEqual({ planId: "growth", kind: "annual" });
    expect(parseLookupKey("dinequora_starter_implementation")).toEqual({
      planId: "starter",
      kind: "implementation",
    });
    expect(parseLookupKey("other_growth_annual")).toBeNull();
    expect(parseLookupKey(null)).toBeNull();
  });
});

describe("checkout charges only the implementation still owed", () => {
  const base = {
    orgId: ORG,
    planId: "growth",
    period: "monthly" as const,
    subscriptionPriceId: "price_m",
    customerId: "cus_1",
    email: null,
    origin: "https://app.dinequora.com",
  };
  it("whole fee, part of it, or nothing", () => {
    expect(
      buildCheckoutParams({ ...base, implementation: { price: "price_i" } }).line_items,
    ).toEqual([
      { price: "price_m", quantity: 1 },
      { price: "price_i", quantity: 1 },
    ]);
    expect(
      buildCheckoutParams({
        ...base,
        implementation: { product: "prod_i", amountCents: 25099 },
      }).line_items[1],
    ).toEqual({
      price_data: { currency: "usd", product: "prod_i", unit_amount: 25099 },
      quantity: 1,
    });
    expect(buildCheckoutParams({ ...base, implementation: null }).line_items).toHaveLength(1);
  });
});

describe("webhook after a change", () => {
  it("takes the plan from the price and flags a price change", () => {
    const m = mapStripeEvent({
      id: "evt_c",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          status: "active",
          metadata: { org_id: ORG, plan_id: "starter" },
          items: {
            data: [
              {
                price: {
                  lookup_key: "dinequora_growth_annual",
                  recurring: { interval: "year", interval_count: 1 },
                },
              },
            ],
          },
        },
        previous_attributes: { items: { data: [] } },
      },
    });
    expect(m.kind).toBe("apply");
    if (m.kind !== "apply") return;
    expect(m.update._plan).toBe("growth");
    expect(m.update._billing_period).toBe("annual");
    expect(m.itemsChanged).toBe(true);
    expect(billingEmailKind(m.update, { itemsChanged: true })).toBe("changed");
    expect(billingEmailKind(m.update, { itemsChanged: false })).toBeNull();
  });

  it("the change e-mail says the new plan and when it renews", () => {
    const mail = renderBillingEmail("changed", "pt", {
      orgName: "Teste Dinequora",
      planName: "Growth",
      amountCents: 121400,
      currency: "usd",
      period: "annual",
      appUrl: "https://app.dinequora.com",
    });
    expect(mail.subject).toBe("Seu plano Dinequora foi alterado");
    expect(mail.text).toMatch(/plano Dinequora Growth \(US\$\s?1\.214,00\/ano\)\./);
    expect(mail.text).toContain("renova automaticamente todo ano");
  });
});

/** Fake signed-in client: owner, subscription row, plans and locations. */
function fakeClient(opts: { stores?: string[]; customer?: string | null; status?: string } = {}) {
  const plans: Record<string, object> = {
    starter: {
      id: "starter",
      monthly_price_cents: 6900,
      semiannual_price_cents: 38100,
      annual_price_cents: 70400,
      implementation_fee_cents: 14900,
      implementation_fee_is_minimum: false,
      default_store_limit: 1,
      active: true,
    },
    growth: {
      id: "growth",
      monthly_price_cents: 11900,
      semiannual_price_cents: 65700,
      annual_price_cents: 121400,
      implementation_fee_cents: 39999,
      implementation_fee_is_minimum: false,
      default_store_limit: 3,
      active: true,
    },
  };
  const from = (table: string) => {
    let id = "";
    const result = () => {
      if (table === "billing_plans") return id ? (plans[id] ?? null) : Object.values(plans);
      if (table === "locations") return (opts.stores ?? ["active"]).map((status) => ({ status }));
      return {
        plan_id: "starter",
        status: opts.status ?? "active",
        stripe_customer_id: opts.customer === undefined ? "cus_1" : opts.customer,
        stripe_subscription_id: "sub_1",
      };
    };
    const q = {
      select: () => q,
      eq: (col: string, v: string) => {
        if (col === "id") id = v;
        return q;
      },
      maybeSingle: async () => ({ data: result(), error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: result(), error: null }),
    };
    return q;
  };
  return {
    rpc: async () => ({ data: true, error: null }),
    from,
    auth: { getUser: async () => ({ data: { user: { email: "owner@example.com" } } }) },
  } as unknown as Parameters<typeof changePlanForOwner>[0];
}

const PRICES: Record<string, { amount: number; product: string }> = {
  dinequora_starter_monthly: { amount: 6900, product: "prod_s" },
  dinequora_starter_semiannual: { amount: 38100, product: "prod_s" },
  dinequora_starter_annual: { amount: 70400, product: "prod_s" },
  dinequora_growth_monthly: { amount: 11900, product: "prod_g" },
  dinequora_growth_annual: { amount: 121400, product: "prod_g" },
  dinequora_starter_implementation: { amount: 14900, product: "prod_si" },
  dinequora_growth_implementation: { amount: 39999, product: "prod_gi" },
};

/** Fake Stripe: records every call; the subscription is Starter on `current`. */
function fakeStripe(current: string, opts: { declined?: boolean; schedule?: string | null } = {}) {
  const calls: { method: string; path: string; body: string }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const body =
      method === "GET"
        ? decodeURIComponent(u.search)
        : decodeURIComponent(String(init?.body ?? ""));
    calls.push({ method, path: u.pathname, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.pathname === "/v1/prices") {
      const keys = [...u.searchParams.entries()]
        .filter(([k]) => k.startsWith("lookup_keys"))
        .map(([, v]) => v);
      return json({
        data: keys
          .filter((k) => PRICES[k])
          .map((k) => ({
            id: `price_${k}`,
            lookup_key: k,
            unit_amount: PRICES[k]!.amount,
            product: PRICES[k]!.product,
          })),
      });
    }
    if (u.pathname === "/v1/subscriptions/sub_1" && method === "GET")
      return json({
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        schedule: opts.schedule ?? null,
        items: {
          data: [
            {
              id: "si_1",
              current_period_end: 1_830_000_000,
              price: { id: `price_${current}`, lookup_key: current },
            },
          ],
        },
      });
    if (u.pathname === "/v1/invoices")
      return json({
        data: [
          {
            lines: {
              data: [
                { amount: 14900, pricing: { price_details: { product: "prod_si" } } },
                { amount: 6900, pricing: { price_details: { product: "prod_s" } } },
              ],
            },
          },
        ],
      });
    if (u.pathname === "/v1/invoices/create_preview")
      return json({
        amount_due: 139599,
        lines: { data: [{ amount: -6900 }, { amount: 25099 }, { amount: 121400 }] },
      });
    if (u.pathname === "/v1/subscriptions/sub_1" && method === "POST")
      return opts.declined
        ? json({ error: { code: "card_declined", message: "declined" } }, 402)
        : json({ id: "sub_1" });
    if (u.pathname === "/v1/subscription_schedules" && method === "POST")
      return json({
        id: "sub_sched_1",
        phases: [
          {
            start_date: 1_800_000_000,
            end_date: 1_830_000_000,
            items: [{ price: `price_${current}` }],
          },
        ],
      });
    if (u.pathname.startsWith("/v1/subscription_schedules/")) return json({ id: "sub_sched_1" });
    return json({ error: { message: `unexpected ${method} ${u.pathname}` } }, 500);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

const env = { STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_1" };
const change = (
  planId: string,
  period: "monthly" | "semiannual" | "annual",
  confirm: boolean,
  client = fakeClient(),
) => changePlanForOwner(client, { orgId: ORG, planId, period, confirm }, env);

describe("changePlanForOwner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("previews Starter monthly -> Growth yearly: credit and only the implementation difference", async () => {
    const calls = fakeStripe("dinequora_starter_monthly");
    expect(await change("growth", "annual", false)).toEqual({
      status: "preview",
      kind: "now",
      planId: "growth",
      period: "annual",
      newPriceCents: 121400,
      amountDueCents: 139599,
      creditCents: 6900,
      implementationCents: 25099,
    });
    const preview = calls.find((c) => c.path === "/v1/invoices/create_preview")!;
    expect(preview.body).toContain("invoice_items[0][price_data][unit_amount]=25099");
    expect(preview.body).toContain("invoice_items[0][price_data][product]=prod_gi");
    expect(preview.body).toContain("subscription_details[proration_behavior]=always_invoice");
    expect(calls.some((c) => c.method === "POST" && c.path === "/v1/subscriptions/sub_1")).toBe(
      false,
    );
  });

  it("a longer period on the same plan adds no implementation", async () => {
    const calls = fakeStripe("dinequora_starter_monthly");
    const r = await change("starter", "annual", false);
    expect(r).toMatchObject({ status: "preview", kind: "now", implementationCents: 0 });
    expect(calls.find((c) => c.path === "/v1/invoices/create_preview")!.body).not.toContain(
      "invoice_items",
    );
    expect(calls.some((c) => c.path === "/v1/invoices")).toBe(false);
  });

  it("confirms now: swaps the price, credits, charges at once, refuses a declined card", async () => {
    const calls = fakeStripe("dinequora_starter_monthly", { schedule: "sub_sched_old" });
    expect(await change("growth", "monthly", true)).toEqual({ status: "changed" });
    const update = calls.find((c) => c.method === "POST" && c.path === "/v1/subscriptions/sub_1")!;
    expect(update.body).toContain("items[0][id]=si_1");
    expect(update.body).toContain("items[0][price]=price_dinequora_growth_monthly");
    expect(update.body).toContain("payment_behavior=error_if_incomplete");
    expect(update.body).toContain("add_invoice_items[0][price_data][unit_amount]=25099");
    expect(update.body).toContain("metadata[plan_id]=growth");
    // the pending change at period end was released first
    expect(calls.some((c) => c.path === "/v1/subscription_schedules/sub_sched_old/release")).toBe(
      true,
    );
    vi.unstubAllGlobals();
    fakeStripe("dinequora_starter_monthly", { declined: true });
    expect(await change("growth", "monthly", true)).toEqual({ status: "payment_failed" });
  });

  it("schedules a shorter period for the end of the paid period, charging nothing now", async () => {
    const calls = fakeStripe("dinequora_starter_annual");
    expect(await change("starter", "monthly", false)).toMatchObject({
      status: "preview",
      kind: "at_period_end",
      effectiveAt: new Date(1_830_000_000_000).toISOString(),
    });
    expect(await change("starter", "monthly", true)).toEqual({
      status: "scheduled",
      effectiveAt: new Date(1_830_000_000_000).toISOString(),
    });
    const phases = calls.find(
      (c) => c.method === "POST" && c.path === "/v1/subscription_schedules/sub_sched_1",
    )!;
    expect(phases.body).toContain("end_behavior=release");
    expect(phases.body).toContain("phases[0][items][0][price]=price_dinequora_starter_annual");
    expect(phases.body).toContain("phases[1][items][0][price]=price_dinequora_starter_monthly");
    expect(phases.body).toContain("phases[1][metadata][billing_period]=monthly");
    expect(calls.some((c) => c.path === "/v1/invoices/create_preview")).toBe(false);
    expect(calls.some((c) => c.method === "POST" && c.path === "/v1/subscriptions/sub_1")).toBe(
      false,
    );
  });

  it("refuses: same plan, mixed change, a smaller plan that does not fit the locations", async () => {
    fakeStripe("dinequora_starter_monthly");
    expect(await change("starter", "monthly", false)).toEqual({ status: "same" });
    vi.unstubAllGlobals();
    fakeStripe("dinequora_starter_annual");
    expect(await change("growth", "monthly", false)).toEqual({ status: "contact_support" });
    vi.unstubAllGlobals();
    fakeStripe("dinequora_growth_monthly");
    expect(
      await change(
        "starter",
        "monthly",
        false,
        fakeClient({ stores: ["active", "active", "inactive"] }),
      ),
    ).toEqual({ status: "too_many_locations" });
    expect(
      await change("starter", "monthly", false, fakeClient({ stores: ["active", "inactive"] })),
    ).toMatchObject({ status: "preview", kind: "at_period_end" });
  });
});

describe("buying again after a cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not charge the implementation already paid", async () => {
    const calls = fakeStripe("dinequora_starter_monthly");
    const client = fakeClient({ status: "canceled" });
    const r = await startCheckoutForOwner(
      client,
      { orgId: ORG, planId: "starter", period: "annual" },
      "https://app.dinequora.com",
      env,
    );
    // The fake Stripe has no checkout endpoint: what matters is the request it was sent.
    expect(r).toEqual({ status: "unavailable" });
    const session = calls.find((c) => c.path === "/v1/checkout/sessions")!;
    expect(session.body).toContain("line_items[0][price]=price_dinequora_starter_annual");
    expect(session.body).not.toContain("line_items[1]");
    expect(session.body).toContain("customer=cus_1");
  });

  it("charges the difference when coming back on a bigger plan", async () => {
    const calls = fakeStripe("dinequora_starter_monthly");
    await startCheckoutForOwner(
      fakeClient({ status: "canceled" }),
      { orgId: ORG, planId: "growth", period: "monthly" },
      "https://app.dinequora.com",
      env,
    );
    const session = calls.find((c) => c.path === "/v1/checkout/sessions")!;
    expect(session.body).toContain("line_items[1][price_data][unit_amount]=25099");
    expect(session.body).toContain("line_items[1][price_data][product]=prod_gi");
  });
});
