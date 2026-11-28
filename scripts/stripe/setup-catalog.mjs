// Creates (or checks) the Stripe catalog for Dinequora Billing, idempotently:
//   - one product per self-serve plan, a monthly price and a one-time implementation price, found by
//     lookup key (dinequora_<plan>_monthly / dinequora_<plan>_implementation), amounts = billing_plans
//     (migration 0047, the website's prices);
//   - the default billing portal configuration (card, invoices, cancel at period end), if none;
//   - optionally the webhook endpoint (--webhook-url), whose signing secret is APPENDED to the file
//     given by --secret-out and never printed.
//
//   node --env-file=<secrets file with STRIPE_SECRET_KEY> scripts/stripe/setup-catalog.mjs \
//        [--webhook-url https://app.dinequora.com/api/public/stripe-webhook --secret-out <file>]
//
// Test keys only (sk_test_/rk_test_): live mode is a separate, explicitly approved step.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const API_VERSION = "2025-03-31.basil";
/** Self-serve plans (Enterprise is a contract: no online checkout). Amounts in US cents. */
export const PLANS = [
  { id: "starter", name: "Dinequora Starter", monthly: 6900, implementation: 14900 },
  { id: "growth", name: "Dinequora Growth", monthly: 11900, implementation: 39999 },
];
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];
export const lookupKeys = (planId) => ({
  monthly: `dinequora_${planId}_monthly`,
  implementation: `dinequora_${planId}_implementation`,
});

function encode(params, prefix = "", out = []) {
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v))
      v.forEach((x, i) =>
        typeof x === "object"
          ? encode(x, `${key}[${i}]`, out)
          : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`),
      );
    else if (typeof v === "object") encode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

async function stripe(key, method, p, params = {}) {
  const body = encode(params).join("&");
  const res = await fetch(
    `https://api.stripe.com${p}${method === "GET" && body ? `?${body}` : ""}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Stripe-Version": API_VERSION,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: method === "POST" ? body : undefined,
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`stripe ${method} ${p}: ${json.error?.message ?? res.status}`);
  return json;
}

async function ensurePrice(key, plan, kind) {
  const lookup = lookupKeys(plan.id)[kind];
  const amount = plan[kind];
  const found = (
    await stripe(key, "GET", "/v1/prices", { lookup_keys: [lookup], active: true, limit: 1 })
  ).data[0];
  if (found && found.unit_amount === amount && found.currency === "usd")
    return { lookup, id: found.id, product: found.product, state: "exists" };
  let product = found?.product;
  if (!product) {
    const existing = await stripe(key, "GET", "/v1/products/search", {
      query: `metadata['plan_id']:'${plan.id}'`,
    });
    product =
      existing.data[0]?.id ??
      (
        await stripe(key, "POST", "/v1/products", {
          name: plan.name,
          metadata: { plan_id: plan.id },
        })
      ).id;
  }
  const price = await stripe(key, "POST", "/v1/prices", {
    product,
    currency: "usd",
    unit_amount: amount,
    lookup_key: lookup,
    transfer_lookup_key: true,
    nickname: kind === "monthly" ? `${plan.name} monthly` : `${plan.name} implementation`,
    metadata: { plan_id: plan.id, kind },
    ...(kind === "monthly" ? { recurring: { interval: "month" } } : {}),
  });
  return { lookup, id: price.id, product, state: found ? "replaced" : "created" };
}

async function ensurePortal(key) {
  const existing = await stripe(key, "GET", "/v1/billing_portal/configurations", {
    is_default: true,
    limit: 1,
  });
  if (existing.data[0]) return { id: existing.data[0].id, state: "exists" };
  const created = await stripe(key, "POST", "/v1/billing_portal/configurations", {
    business_profile: { headline: "Dinequora subscription" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
    },
  });
  return { id: created.id, state: "created" };
}

async function ensureWebhook(key, url, secretOut) {
  const list = await stripe(key, "GET", "/v1/webhook_endpoints", { limit: 100 });
  const found = list.data.find((w) => w.url === url);
  if (found) return { id: found.id, state: "exists (signing secret unchanged)" };
  if (!secretOut) throw new Error("--secret-out is required to create the webhook endpoint");
  const created = await stripe(key, "POST", "/v1/webhook_endpoints", {
    url,
    enabled_events: WEBHOOK_EVENTS,
    api_version: API_VERSION,
    description: "Dinequora billing",
  });
  fs.appendFileSync(secretOut, `\nSTRIPE_WEBHOOK_SECRET=${created.secret}\n`);
  return { id: created.id, state: `created (signing secret appended to ${secretOut})` };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--webhook-url") out.webhookUrl = argv[++i];
    else if (argv[i] === "--secret-out") out.secretOut = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (out.webhookUrl && !/^https:\/\/[^/]+\/api\/public\/stripe-webhook$/.test(out.webhookUrl))
    throw new Error("--webhook-url must be https://<host>/api/public/stripe-webhook");
  return out;
}

async function main(argv) {
  const opts = args(argv);
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_test_/.test(key))
    throw new Error("refusing: STRIPE_SECRET_KEY must be a TEST key (sk_test_/rk_test_)");
  for (const plan of PLANS)
    for (const kind of ["monthly", "implementation"]) {
      const r = await ensurePrice(key, plan, kind);
      console.log(`price ${r.lookup}: ${r.state} (${r.id})`);
    }
  const portal = await ensurePortal(key);
  console.log(`billing portal configuration: ${portal.state} (${portal.id})`);
  if (opts.webhookUrl) {
    const w = await ensureWebhook(key, opts.webhookUrl, opts.secretOut);
    console.log(`webhook ${opts.webhookUrl}: ${w.state} (${w.id})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
