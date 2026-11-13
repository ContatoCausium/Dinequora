import { isClientPreview } from "./deployment-profile";

/**
 * Response headers for the client-preview profile, added by `src/server.ts` to every response the
 * server renders (pages, server functions, error pages). Static assets are served by the platform
 * without running the server; `scripts/preview/build-client-preview.mjs` writes the same no-index
 * and hardening headers for them in `.output/public/_headers`.
 *
 * Deliberately no script-src/style-src policy: SSR streams inline hydration scripts and the app loads
 * Google Fonts, so a full CSP needs its own validation. The directives below cannot break rendering.
 * Off in the standard profile, where the Lovable editor embeds the app in an iframe.
 */
export const CLIENT_PREVIEW_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
});

/** HSTS only over https: a plain-http answer (local preview) must never pin the host. */
export const HSTS_HEADER = "max-age=31536000";

export function clientPreviewHeaders(requestUrl: string): Record<string, string> {
  const headers: Record<string, string> = { ...CLIENT_PREVIEW_HEADERS };
  let https = false;
  try {
    https = new URL(requestUrl).protocol === "https:";
  } catch {
    https = false;
  }
  if (https) headers["Strict-Transport-Security"] = HSTS_HEADER;
  return headers;
}

/**
 * Returns the response with the preview headers set (overriding any value already present).
 * Status, status text and body (including a streamed body) are kept as they are.
 */
export function withSecurityHeaders(
  response: Response,
  request: Request,
  enabled: boolean = isClientPreview(),
): Response {
  // A protocol switch (101) cannot be rebuilt; the app never upgrades a connection.
  if (!enabled || response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(clientPreviewHeaders(request.url)))
    headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
