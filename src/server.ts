import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { captureError } from "./lib/observability";
import { configureObservability } from "./lib/observability-config";
import { withSecurityHeaders } from "./lib/security-headers";
import { STRIPE_IN_BUILD, STRIPE_WEBHOOK_PATH } from "./lib/stripe/build-flags";
import type { Database } from "./integrations/supabase/types";

// Alert/exception destinations come only from server environment variables; none by default.
configureObservability(process.env);

/** Method + path only: query strings can carry tokens (auth callbacks, invites). */
const requestContext = (request: Request) => {
  try {
    return { method: request.method, path: new URL(request.url).pathname };
  } catch {
    return { method: request.method };
  }
};

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  language: string,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  captureError(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`), {
    event: "server.ssr_failed",
    critical: true,
    ...requestContext(request),
  });
  return new Response(renderErrorPage(language), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * Stripe webhook (src/lib/stripe/billing-webhook.ts): handled before the app router because it has
 * no session and needs the raw body for the signature check. Applies the event with the service
 * role (billing_apply_stripe_event is EXECUTE-granted to service_role only).
 */
async function handleStripeWebhookRequest(request: Request): Promise<Response> {
  const [{ handleStripeWebhook }, { supabaseAdmin }, { notifyBillingChange }] = await Promise.all([
    import("./lib/stripe/billing-webhook"),
    import("./integrations/supabase/client.server"),
    import("./lib/stripe/billing-notify"),
  ]);
  // Stripe calls the app's own public address, so the request origin is the link in the e-mails.
  const appUrl = new URL(request.url).origin;
  return handleStripeWebhook(request, {
    notify: async (update, info) => {
      try {
        const result = await notifyBillingChange(
          supabaseAdmin,
          update,
          appUrl,
          process.env,
          fetch,
          info,
        );
        if (result.status === "sent" && result.failed > 0)
          captureError(new Error(`billing e-mail not delivered to ${result.failed} owner(s)`), {
            event: "billing.email_failed",
            ...requestContext(request),
          });
      } catch (error) {
        captureError(error, { event: "billing.email_failed", ...requestContext(request) });
      }
    },
    secret: process.env["STRIPE_WEBHOOK_SECRET"],
    apply: async (update) => {
      // Several arguments are nullable; the generated types mark every argument as required.
      const { data, error } = await supabaseAdmin.rpc(
        "billing_apply_stripe_event",
        update as unknown as Database["public"]["Functions"]["billing_apply_stripe_event"]["Args"],
      );
      if (error) {
        captureError(new Error(`stripe webhook apply failed: ${error.message}`), {
          event: "billing.stripe_webhook_failed",
          critical: true,
          ...requestContext(request),
        });
        throw error;
      }
      return data === true;
    },
  });
}

async function handle(request: Request, env: unknown, ctx: unknown): Promise<Response> {
  const language = request.headers.get("accept-language") ?? "en-US";
  // Not in the client-preview build (build-flags.ts): the branch and its imports are dropped there.
  if (STRIPE_IN_BUILD && new URL(request.url).pathname === STRIPE_WEBHOOK_PATH)
    return handleStripeWebhookRequest(request);
  try {
    const handler = await getServerEntry();
    const response = await handler.fetch(request, env, ctx);
    return await normalizeCatastrophicSsrResponse(response, language, request);
  } catch (error) {
    captureError(error, {
      event: "server.request_failed",
      critical: true,
      ...requestContext(request),
    });
    return new Response(renderErrorPage(language), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

export default {
  // Security and no-index headers on every server response, error pages included (client-preview
  // profile only; a no-op in the standard profile).
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return withSecurityHeaders(await handle(request, env, ctx), request);
  },
};
