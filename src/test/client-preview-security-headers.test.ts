import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Client preview: every response produced by the server (pages, server functions, the catastrophic
 * SSR fallback and the error page of a thrown request) carries no-index and hardening headers.
 * The standard profile is unchanged (the Lovable editor frames the app). The TanStack server entry
 * is mocked; the real src/server.ts wrapper runs.
 */
const entry = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: entry }));

import {
  CLIENT_PREVIEW_HEADERS,
  clientPreviewHeaders,
  HSTS_HEADER,
  withSecurityHeaders,
} from "@/lib/security-headers";
import server from "@/server";

const HTTPS = "https://preview.example.test/auth";
const HTTP = "http://127.0.0.1:8799/auth";
const req = (url = HTTPS) => new Request(url, { headers: { "accept-language": "en-US" } });
const html = (body = "<html>ok</html>", status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

beforeEach(() => {
  entry.fetch.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

function expectPreviewHeaders(res: Response, https: boolean) {
  for (const [name, value] of Object.entries(CLIENT_PREVIEW_HEADERS))
    expect(res.headers.get(name), name).toBe(value);
  expect(res.headers.get("Strict-Transport-Security")).toBe(https ? HSTS_HEADER : null);
}

describe("header set", () => {
  it("forbids indexing, framing, sniffing and powerful browser features", () => {
    expect(CLIENT_PREVIEW_HEADERS["X-Robots-Tag"]).toBe("noindex, nofollow, noarchive");
    expect(CLIENT_PREVIEW_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(CLIENT_PREVIEW_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(CLIENT_PREVIEW_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(CLIENT_PREVIEW_HEADERS["Permissions-Policy"]).toContain("camera=()");
  });
  it("adds HSTS only over https", () => {
    expect(clientPreviewHeaders(HTTPS)["Strict-Transport-Security"]).toBe(HSTS_HEADER);
    expect(clientPreviewHeaders(HTTP)["Strict-Transport-Security"]).toBeUndefined();
    expect(clientPreviewHeaders("not a url")["Strict-Transport-Security"]).toBeUndefined();
  });
  it("keeps status, status text and body, and overrides a weaker value", async () => {
    const original = new Response("payload", {
      status: 404,
      statusText: "Not Found",
      headers: { "x-frame-options": "SAMEORIGIN", "content-type": "text/plain" },
    });
    const res = withSecurityHeaders(original, req(), true);
    expect(res.status).toBe(404);
    expect(res.statusText).toBe("Not Found");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(await res.text()).toBe("payload");
  });
  it("keeps a streamed body intact", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("<html>"));
        c.enqueue(new TextEncoder().encode("streamed</html>"));
        c.close();
      },
    });
    const res = withSecurityHeaders(new Response(stream), req(), true);
    expect(await res.text()).toBe("<html>streamed</html>");
  });
  it("is a no-op when disabled", () => {
    const original = html();
    expect(withSecurityHeaders(original, req(), false)).toBe(original);
  });
});

describe("src/server.ts", () => {
  it("client preview: page responses carry the headers (https adds HSTS)", async () => {
    vi.stubEnv("VITE_DEPLOYMENT_PROFILE", "client-preview");
    entry.fetch.mockResolvedValue(html());
    const res = await server.fetch(req(), {}, {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>ok</html>");
    expectPreviewHeaders(res, true);
  });

  it("client preview: plain-http local runs get the headers without HSTS", async () => {
    vi.stubEnv("VITE_DEPLOYMENT_PROFILE", "client-preview");
    entry.fetch.mockResolvedValue(html());
    expectPreviewHeaders(await server.fetch(req(HTTP), {}, {}), false);
  });

  it("client preview: server-function and redirect responses carry the headers", async () => {
    vi.stubEnv("VITE_DEPLOYMENT_PROFILE", "client-preview");
    entry.fetch.mockResolvedValue(
      new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
    );
    expectPreviewHeaders(await server.fetch(req(), {}, {}), true);
    entry.fetch.mockResolvedValue(
      new Response(null, { status: 307, headers: { location: "/auth" } }),
    );
    const redirect = await server.fetch(req(), {}, {});
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("/auth");
    expectPreviewHeaders(redirect, true);
  });

  it("client preview: the error page of a failed request carries the headers", async () => {
    vi.stubEnv("VITE_DEPLOYMENT_PROFILE", "client-preview");
    entry.fetch.mockImplementation(async () => {
      throw new Error("boom");
    });
    const res = await server.fetch(req(), {}, {});
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
    expectPreviewHeaders(res, true);
  });

  it("client preview: the catastrophic SSR fallback carries the headers", async () => {
    vi.stubEnv("VITE_DEPLOYMENT_PROFILE", "client-preview");
    entry.fetch.mockResolvedValue(
      new Response('{"unhandled":true,"message":"HTTPError"}', {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await server.fetch(req(), {}, {});
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
    expectPreviewHeaders(res, true);
  });

  it("standard profile: responses are passed through untouched", async () => {
    vi.stubEnv("VITE_DEPLOYMENT_PROFILE", "");
    const original = html();
    entry.fetch.mockResolvedValue(original);
    const res = await server.fetch(req(), {}, {});
    expect(res).toBe(original);
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBeNull();
  });
});
