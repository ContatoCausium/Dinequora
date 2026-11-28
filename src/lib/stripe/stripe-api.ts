/**
 * Minimal Stripe REST client and webhook signature check, with no SDK: plain `fetch` and Web Crypto,
 * so the same code runs in the Cloudflare Worker and in tests.
 *
 * The Stripe secret key and the webhook signing secret are server-only Worker secrets, passed in
 * by the callers; this module reads no environment variable.
 */

/** Pinned so request and response shapes do not change under us when Stripe releases a version. */
export const STRIPE_API_VERSION = "2025-03-31.basil";
const API = "https://api.stripe.com";

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

type Param = string | number | boolean | null | undefined | Param[] | { [k: string]: Param };

/** Stripe's form encoding: nested objects as a[b]=, arrays as a[0]=. Null/undefined are skipped. */
export function formEncode(params: Record<string, Param>): string {
  const out: string[] = [];
  const walk = (key: string, value: Param) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${key}[${i}]`, v));
    else if (typeof value === "object")
      for (const [k, v] of Object.entries(value)) walk(`${key}[${k}]`, v);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join("&");
}

export type StripeFetch = typeof fetch;

/** One Stripe API call. Throws StripeApiError with Stripe's message on a non-2xx answer. */
export async function stripeRequest<T>(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  params: Record<string, Param> = {},
  { idempotencyKey, fetchImpl = fetch }: { idempotencyKey?: string; fetchImpl?: StripeFetch } = {},
): Promise<T> {
  const body = formEncode(params);
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetchImpl(url, {
    method,
    headers,
    body: method === "POST" ? body : null,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string };
  };
  if (!res.ok)
    throw new StripeApiError(
      res.status,
      json.error?.code,
      json.error?.message ?? `stripe_http_${res.status}`,
    );
  return json as T;
}

/** Test keys start with sk_test_ / rk_test_; live keys with sk_live_ / rk_live_. */
export function stripeKeyMode(key: string | undefined): "test" | "live" | null {
  if (!key) return null;
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return null;
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 of `${timestamp}.${payload}` with the signing secret, hex (Stripe's v1 scheme). */
export async function stripeSignature(
  payload: string,
  timestamp: number,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`)));
}

/**
 * Verifies the Stripe-Signature header (t=…,v1=…[,v1=…]) against the RAW request body. Refuses a
 * missing or malformed header, a timestamp outside the tolerance (replays) and any signature that
 * does not match. Several v1 entries are allowed (secret rotation): one match is enough.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  {
    toleranceSeconds = 300,
    now = Date.now(),
  }: { toleranceSeconds?: number | undefined; now?: number | undefined } = {},
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t" && v && /^\d+$/.test(v)) timestamp = Number(v);
    else if (k === "v1" && v) signatures.push(v);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = await stripeSignature(payload, timestamp, secret);
  return signatures.some((s) => timingSafeEqual(s, expected));
}
