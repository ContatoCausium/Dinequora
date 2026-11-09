import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetObservabilityForTests,
  captureError,
  registerErrorReporter,
  setLogWriter,
  type LogRecord,
} from "@/lib/observability";
import {
  __resetObservabilityConfigForTests,
  configureObservability,
  parseWebhookUrl,
} from "@/lib/observability-config";
import { supportEmail } from "@/lib/platform-contact";

let restore: ReturnType<typeof setLogWriter>;
beforeEach(() => {
  __resetObservabilityForTests();
  __resetObservabilityConfigForTests();
  restore = setLogWriter(() => {});
});
afterEach(() => {
  setLogWriter(restore);
  __resetObservabilityForTests();
  __resetObservabilityConfigForTests();
});
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("alert configuration from environment", () => {
  it("is disabled and sends nothing when no variable is set", async () => {
    const fetchImpl = vi.fn();
    expect(configureObservability({}, fetchImpl as unknown as typeof fetch)).toEqual({
      alertWebhook: "disabled",
      environment: null,
    });
    captureError(new Error("checkout down"), { critical: true });
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-https webhooks (except localhost) and unparsable values", () => {
    expect(parseWebhookUrl("http://hooks.example.com/x")).toBe("rejected");
    expect(parseWebhookUrl("not a url")).toBe("rejected");
    expect(parseWebhookUrl("http://127.0.0.1:9000/hook")).toBeInstanceOf(URL);
    expect(parseWebhookUrl("https://hooks.example.com/x")).toBeInstanceOf(URL);
    expect(parseWebhookUrl(undefined)).toBeNull();
  });

  it("posts critical errors, redacted, to an https webhook", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const status = configureObservability(
      {
        OBSERVABILITY_ALERT_WEBHOOK_URL: "https://hooks.example.com/services/T/B/x",
        OBSERVABILITY_ENVIRONMENT: "staging",
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(status).toEqual({ alertWebhook: "enabled", environment: "staging" });
    captureError(new Error("persist failed for owner@restaurant.com"), {
      event: "pos.sale_failed",
      critical: true,
      password: "x",
    });
    captureError(new Error("not critical"));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.environment).toBe("staging");
    expect(body.record.event).toBe("pos.sale_failed");
    expect(JSON.stringify(body)).not.toContain("owner@restaurant.com");
    expect(body.record.data.password).toBe("[REDACTED]");
  });

  it("a failing webhook never breaks the caller", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    configureObservability(
      { OBSERVABILITY_ALERT_WEBHOOK_URL: "https://hooks.example.com/x" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(() => captureError(new Error("boom"), { critical: true })).not.toThrow();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("exception reporter integration point", () => {
  it("receives every captured error (not plain logs), already redacted", async () => {
    const got: LogRecord[] = [];
    registerErrorReporter((r) => void got.push(r));
    captureError(new Error("token=abc Bearer abcdefghijklmnopq"), { event: "kds.fetch_failed" });
    await flush();
    expect(got).toHaveLength(1);
    expect(got[0]!.error!.message).not.toContain("abcdefghijklmnopq");
  });
});

describe("support contact", () => {
  it("is null until configured; never invented", () => {
    expect(supportEmail({})).toBeNull();
    expect(supportEmail({ VITE_SUPPORT_EMAIL: "  " })).toBeNull();
    expect(supportEmail({ VITE_SUPPORT_EMAIL: "not-an-email" })).toBeNull();
    expect(supportEmail({ VITE_SUPPORT_EMAIL: "help@company.example" })).toBe(
      "help@company.example",
    );
  });
});
