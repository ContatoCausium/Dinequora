import { verifyStripeSignature } from "./stripe-api";

/**
 * Stripe webhook → `billing_apply_stripe_event` (migration 0004; service role only, idempotent by
 * event id). The endpoint is POST /api/public/stripe-webhook, handled in src/server.ts before the
 * app router: no session, the Stripe-Signature over the raw body is the only authentication.
 *
 * Which organization: the Checkout Session is created with `client_reference_id` and
 * `metadata.org_id`, and the subscription with `metadata.org_id` / `metadata.plan_id`
 * (billing.functions.ts), so every event names its organization without trusting the browser.
 */
export { STRIPE_WEBHOOK_PATH } from "./build-flags";

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

/** Arguments of public.billing_apply_stripe_event. */
export type BillingUpdate = {
  _event_id: string;
  _type: string;
  _org_id: string;
  _customer: string | null;
  _subscription: string | null;
  _status: string | null;
  _plan: string | null;
  _period_start: string | null;
  _period_end: string | null;
  _cancel_at_period_end: boolean | null;
  _amount_cents: number | null;
  _currency: string | null;
};

/** The fields read from Stripe payloads (everything else is ignored). */
type Field =
  | "id"
  | "type"
  | "data"
  | "object"
  | "customer"
  | "metadata"
  | "org_id"
  | "plan_id"
  | "client_reference_id"
  | "subscription"
  | "items"
  | "status"
  | "current_period_start"
  | "current_period_end"
  | "cancel_at_period_end"
  | "parent"
  | "subscription_details"
  | "amount_paid"
  | "amount_due"
  | "currency";
type Obj = Partial<Record<Field, unknown>>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
/** Stripe sends either an id or an expanded object. */
const id = (v: unknown): string | null => str(v) ?? str(obj(v).id);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (unix: unknown): string | null => {
  const n = num(unix);
  return n === null ? null : new Date(n * 1000).toISOString();
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgId = (...candidates: unknown[]): string | null => {
  for (const c of candidates) {
    const s = str(c);
    if (s && UUID.test(s)) return s.toLowerCase();
  }
  return null;
};

export type MappedEvent =
  | { kind: "apply"; update: BillingUpdate }
  | { kind: "ignore"; reason: "unhandled_type" | "no_organization" };

/** Pure mapping of a (signature-verified) Stripe event to the database update. */
export function mapStripeEvent(event: unknown): MappedEvent {
  const e = obj(event);
  const type = str(e.type) ?? "";
  const eventId = str(e.id) ?? "";
  const o = obj(obj(e.data).object);
  const base = {
    _event_id: eventId,
    _type: type,
    _customer: id(o.customer),
    _subscription: null as string | null,
    _status: null as string | null,
    _plan: null as string | null,
    _period_start: null as string | null,
    _period_end: null as string | null,
    _cancel_at_period_end: null as boolean | null,
    _amount_cents: null as number | null,
    _currency: null as string | null,
  };

  if (type === "checkout.session.completed") {
    const meta = obj(o.metadata);
    const org = orgId(meta.org_id, o.client_reference_id);
    if (!org) return { kind: "ignore", reason: "no_organization" };
    return {
      kind: "apply",
      update: {
        ...base,
        _org_id: org,
        _subscription: id(o.subscription),
        _plan: str(meta.plan_id),
      },
    };
  }

  if (type.startsWith("customer.subscription.") && HANDLED_EVENTS.includes(type as never)) {
    const meta = obj(o.metadata);
    const org = orgId(meta.org_id);
    if (!org) return { kind: "ignore", reason: "no_organization" };
    // API 2025-03-31.basil moved the billing period to the subscription items.
    const item = obj((obj(o.items).data as unknown[] | undefined)?.[0]);
    return {
      kind: "apply",
      update: {
        ...base,
        _org_id: org,
        _subscription: str(o.id),
        _status: type === "customer.subscription.deleted" ? "canceled" : str(o.status),
        _plan: str(meta.plan_id),
        _period_start: iso(item.current_period_start ?? o.current_period_start),
        _period_end: iso(item.current_period_end ?? o.current_period_end),
        _cancel_at_period_end:
          typeof o.cancel_at_period_end === "boolean" ? o.cancel_at_period_end : null,
      },
    };
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    // basil: invoice.parent.subscription_details; older versions: invoice.subscription_details.
    const details = obj(obj(o.parent).subscription_details);
    const legacy = obj(o.subscription_details);
    const meta = { ...obj(legacy.metadata), ...obj(details.metadata) };
    const org = orgId(meta.org_id);
    if (!org) return { kind: "ignore", reason: "no_organization" };
    const paid = type === "invoice.paid";
    return {
      kind: "apply",
      update: {
        ...base,
        _org_id: org,
        _subscription: id(details.subscription) ?? id(o.subscription),
        _status: paid ? "active" : "past_due",
        _plan: str(meta.plan_id),
        _amount_cents: num(paid ? o.amount_paid : o.amount_due),
        _currency: str(o.currency),
      },
    };
  }

  return { kind: "ignore", reason: "unhandled_type" };
}

export type ApplyBillingUpdate = (update: BillingUpdate) => Promise<boolean>;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/**
 * The webhook endpoint. 400 when the signature does not verify (Stripe shows the failure);
 * 200 for verified events we do not act on; 500 when the database refuses, so Stripe retries
 * (the database ignores a repeated event id).
 */
export async function handleStripeWebhook(
  request: Request,
  { secret, apply, now }: { secret: string | undefined; apply: ApplyBillingUpdate; now?: number },
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!secret) return json(503, { error: "not_configured" });
  const payload = await request.text();
  const ok = await verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret, {
    now,
  });
  if (!ok) return json(400, { error: "invalid_signature" });
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return json(400, { error: "invalid_payload" });
  }
  const mapped = mapStripeEvent(event);
  if (mapped.kind === "ignore") return json(200, { received: true, ignored: mapped.reason });
  try {
    const applied = await apply(mapped.update);
    return json(200, { received: true, duplicate: !applied });
  } catch {
    return json(500, { error: "apply_failed" });
  }
}
