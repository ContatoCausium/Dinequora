import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { captureError } from "./lib/observability";
import { configureObservability } from "./lib/observability-config";

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

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const language = request.headers.get("accept-language") ?? "en-US";
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
  },
};
