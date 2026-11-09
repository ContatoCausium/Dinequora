import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetObservabilityForTests,
  captureError,
  fingerprint,
  isExpectedBusinessError,
  logEvent,
  redact,
  redactString,
  registerAlertSink,
  setLogWriter,
  setObservabilityScope,
  type LogRecord,
} from "@/lib/observability";

// Obviously fake credentials, assembled at runtime so secret scanners never see a literal key.
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
const JWT = [
  b64({ alg: "HS256", typ: "JWT" }),
  b64({ sub: "fake-user", role: "x" }),
  "FAKEsignatureFAKEsignature",
].join(".");
const SB_KEY = ["sb", "secret", "FAKEFAKEFAKEFAKE0000"].join("_");
const STRIPE_KEY = ["sk", "live", "FAKE0000FAKE0000"].join("_");

let lines: string[] = [];
let restore: ReturnType<typeof setLogWriter>;
beforeEach(() => {
  __resetObservabilityForTests();
  lines = [];
  restore = setLogWriter((line) => lines.push(line));
});
afterEach(() => {
  setLogWriter(restore);
  __resetObservabilityForTests();
});
const last = (): LogRecord => JSON.parse(lines.at(-1)!);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("redaction (no passwords, tokens or payment data in logs)", () => {
  it("removes secret-looking keys at any depth", () => {
    const out = redact({
      email: "ok",
      password: "hunter2",
      nested: { access_token: "abc", Authorization: "Bearer x", apiKey: "k", cardNumber: "4111" },
      list: [{ refresh_token: "r", cvv: "123" }],
    }) as {
      password: string;
      nested: Record<string, string>;
      list: Record<string, string>[];
    };
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested["access_token"]).toBe("[REDACTED]");
    expect(out.nested["Authorization"]).toBe("[REDACTED]");
    expect(out.nested["apiKey"]).toBe("[REDACTED]");
    expect(out.nested["cardNumber"]).toBe("[REDACTED]");
    expect(out.list[0]).toEqual({ refresh_token: "[REDACTED]", cvv: "[REDACTED]" });
  });

  it("masks JWTs, bearer tokens, Supabase/Stripe keys, card numbers and e-mails in text", () => {
    const s = redactString(
      `jwt ${JWT} | Bearer abcdefghijklmnop | ${SB_KEY} | ${STRIPE_KEY} | card 4111 1111 1111 1111 | owner@restaurant.com | /cb?access_token=zzz&x=1`,
    );
    expect(s).not.toContain("eyJhbGci");
    expect(s).not.toContain("abcdefghijklmnop");
    expect(s).not.toContain("FAKEFAKEFAKEFAKE0000");
    expect(s).not.toContain("FAKE0000FAKE0000");
    expect(s).not.toContain("4111 1111 1111 1111");
    expect(s).not.toContain("owner@restaurant.com");
    expect(s).toContain("o***@restaurant.com");
    expect(s).toContain("access_token=[REDACTED]");
  });

  it("keeps ordinary numbers that are not valid card numbers (Luhn)", () => {
    expect(redactString("order 1234567890123 total 4500")).toBe("order 1234567890123 total 4500");
  });

  it("survives cycles and non-plain values", () => {
    const a: Record<string, unknown> = { name: "x" };
    a["self"] = a;
    expect(redact(a)).toEqual({ name: "x", self: "[Circular]" });
    expect(redact(new Error(`boom ${JWT}`))).toEqual({
      name: "Error",
      message: "boom [REDACTED_JWT]",
    });
  });
});

describe("structured logs with org/store scope", () => {
  it("emits one JSON line with level, event, runtime and the registered scope", () => {
    setObservabilityScope({ orgId: "org-uuid", locationId: "loc_1", userId: "u-1", role: "staff" });
    logEvent("info", "pos.opened", { password: "nope", items: 2 });
    const r = last();
    expect(r).toMatchObject({
      level: "info",
      event: "pos.opened",
      scope: { orgId: "org-uuid", locationId: "loc_1", userId: "u-1", role: "staff" },
      data: { password: "[REDACTED]", items: 2 },
    });
    expect(typeof r.ts).toBe("string");
    expect(["server", "browser"]).toContain(r.runtime);
  });

  it("clears the scope on sign-out", () => {
    setObservabilityScope({ orgId: "o" });
    setObservabilityScope({});
    logEvent("info", "x");
    expect(last().scope).toEqual({});
  });

  it("captureError records message, redacted detail and a stable fingerprint", () => {
    const err = new Error(`fetch failed for ${JWT}`);
    const r = captureError(err, { event: "kds.fetch_failed", token: "t" });
    expect(r.level).toBe("error");
    expect(r.error!.message).toContain("[REDACTED_JWT]");
    expect(r.error!.detail).not.toContain("eyJhbGci");
    expect(r.data).toEqual({ token: "[REDACTED]" });
    expect(r.error!.fingerprint).toBe(fingerprint(err));
    expect(lines).toHaveLength(1);
  });
});

describe("critical alerts", () => {
  it("notifies sinks once per fingerprint within the window and isolates failing sinks", async () => {
    const got: LogRecord[] = [];
    registerAlertSink(() => {
      throw new Error("sink down");
    });
    registerAlertSink((r) => void got.push(r));
    const err = new Error("checkout exploded");
    captureError(err, { event: "pos.sale_failed", critical: true });
    captureError(err, { event: "pos.sale_failed", critical: true });
    captureError(new Error("other failure"), { event: "server.request_failed", critical: true });
    captureError(new Error("not critical"), { event: "kds.fetch_failed" });
    await flush();
    expect(got.map((r) => r.event)).toEqual(["pos.sale_failed", "server.request_failed"]);
    expect(got.every((r) => r.level === "critical")).toBe(true);
  });

  it("does not page on expected business rejections", () => {
    expect(isExpectedBusinessError(new Error("permission_denied"))).toBe(true);
    expect(isExpectedBusinessError(new Error("insufficient_stock"))).toBe(true);
    expect(isExpectedBusinessError(new Error("subscription_inactive"))).toBe(true);
    expect(isExpectedBusinessError(new Error("Failed to fetch"))).toBe(false);
    expect(isExpectedBusinessError(new TypeError("x is undefined"))).toBe(false);
  });
});
