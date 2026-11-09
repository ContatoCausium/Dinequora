/**
 * Environment wiring for alerts and exception reporting (server side).
 *
 * Nothing is configured by default and nothing leaves the process until an operator sets the
 * variables below on the server. No credential, URL or address is hard-coded here.
 *
 *   OBSERVABILITY_ALERT_WEBHOOK_URL   https URL that receives critical errors as JSON (POST).
 *                                     Suits Slack/Teams/PagerDuty/Opsgenie-style incoming webhooks
 *                                     or an internal relay. Must be https (localhost http allowed
 *                                     for local testing only).
 *   OBSERVABILITY_ENVIRONMENT         label added to every alert (e.g. "production", "staging").
 *
 * An exception-tracking provider (e.g. Sentry) plugs in through `registerErrorReporter` with an
 * adapter module added once the provider and its DSN are approved.
 */
import { registerAlertSink, type LogRecord } from "./observability";

export type ObservabilityEnv = Partial<
  Record<"OBSERVABILITY_ALERT_WEBHOOK_URL" | "OBSERVABILITY_ENVIRONMENT", string | undefined>
>;
export type ObservabilityStatus = {
  alertWebhook: "disabled" | "enabled" | "rejected";
  environment: string | null;
};

const ALLOWED_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

/** Validates the webhook URL without ever logging it (it may embed a secret token). */
export function parseWebhookUrl(raw: string | undefined): URL | null | "rejected" {
  if (!raw || raw.trim() === "") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "https:" || ALLOWED_LOCAL.test(u.href)) return u;
    return "rejected";
  } catch {
    return "rejected";
  }
}

export function webhookAlertSink(
  url: URL,
  environment: string | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
) {
  return async (record: LogRecord) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // `record` is already redacted by observability.ts (no secrets, masked PII).
      await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "dinequora",
          environment,
          text: `[${environment ?? "unknown"}] ${record.event}: ${record.error?.message ?? ""}`.slice(
            0,
            500,
          ),
          record,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

let configured = false;
/** Idempotent; call once at server start. Returns what was enabled (no URLs or secrets). */
export function configureObservability(
  env: ObservabilityEnv,
  fetchImpl: typeof fetch = fetch,
): ObservabilityStatus {
  const environment = env.OBSERVABILITY_ENVIRONMENT?.trim() || null;
  const parsed = parseWebhookUrl(env.OBSERVABILITY_ALERT_WEBHOOK_URL);
  const status: ObservabilityStatus = {
    alertWebhook: parsed === null ? "disabled" : parsed === "rejected" ? "rejected" : "enabled",
    environment,
  };
  if (configured) return status;
  configured = true;
  if (parsed instanceof URL) registerAlertSink(webhookAlertSink(parsed, environment, fetchImpl));
  return status;
}

/** Test-only. */
export function __resetObservabilityConfigForTests(): void {
  configured = false;
}
