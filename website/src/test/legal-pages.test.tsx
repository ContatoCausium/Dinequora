import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { englishIndexHtml, legalIndexHtml } from "../build/seo";
import { COMPANY, MISSING_FACT_LABELS, missingFacts } from "../config/company";
import { addressFor, legalMeta, pageFromPath, pagePath } from "../i18n/meta";
import { privacyPolicy } from "../legal/privacy";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("legal page addresses", () => {
  it("gives each page its own path per language", () => {
    expect(pagePath("home", "en")).toBe("/");
    expect(pagePath("home", "pt")).toBe("/pt/");
    expect(pagePath("privacy", "en")).toBe("/privacy/");
    expect(pagePath("privacy", "pt")).toBe("/pt/privacy/");
  });

  it("reads the page from the path, with or without the trailing slash", () => {
    for (const path of ["/privacy", "/privacy/", "/pt/privacy", "/pt/privacy/"]) expect(pageFromPath(path)).toBe("privacy");
    for (const path of ["/", "/pt/", "/pt", "/privacy-x/", "/ptprivacy/", "/foo/privacy/"]) expect(pageFromPath(path)).toBe("home");
  });

  it("switches language without leaving the legal page", () => {
    expect(addressFor("pt", "https://dinequora.com/privacy/")).toBe("/pt/privacy/");
    expect(addressFor("en", "https://dinequora.com/pt/privacy/#your-rights")).toBe("/privacy/#your-rights");
    expect(addressFor("en", "https://dinequora.com/pt/privacy")).toBe("/privacy/");
  });
});

describe("footer", () => {
  it("links to the privacy policy from the home page in both languages", async () => {
    render(<App />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy/");
    await userEvent.click(screen.getAllByRole("button", { name: /Português/ })[0]!);
    expect(within(footer).getByRole("link", { name: "Política de privacidade" })).toHaveAttribute("href", "/pt/privacy/");
  });

  it("keeps in-page anchors on the home page and points them home from a legal page", () => {
    const { unmount } = render(<App />);
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "#pricing");
    unmount();
    window.history.replaceState(null, "", "/pt/privacy/");
    render(<App page="privacy" />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Preços" })).toHaveAttribute("href", "/pt/#pricing");
    expect(within(footer).getByRole("link", { name: "Agendar demonstração" })).toHaveAttribute("href", "/pt/#demo");
  });
});

describe("opening the home page at a section", () => {
  it("jumps to the section once the page is laid out (footer links from a legal page)", async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      window.history.replaceState(null, "", "/#pricing");
      render(<App />);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(scrolled).toEqual(["pricing"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe("privacy policy page", () => {
  it("renders the policy with its own title, a way back home and every section", () => {
    window.history.replaceState(null, "", "/privacy/");
    render(<App page="privacy" />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(document.title).toBe(legalMeta.privacy.en.title);
    expect(screen.getByRole("link", { name: "Dinequora home" })).toHaveAttribute("href", "/");
    for (const section of privacyPolicy.en.sections) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
    }
    // The home page's film is not on the legal page.
    expect(document.getElementById("demo")).toBeNull();
    expect(window.location.pathname).toBe("/privacy/");
  });

  it("describes what the site does today: WhatsApp hand-off, cookieless analytics, no ad trackers", () => {
    window.history.replaceState(null, "", "/privacy/");
    render(<App page="privacy" />);
    const text = document.querySelector("main")!.textContent!;
    expect(text).toMatch(/opens WhatsApp with your request filled in/);
    expect(text).toMatch(/Cloudflare Web Analytics, which does not use cookies/);
    expect(text).toMatch(/does not use Google Analytics, the Meta Pixel/);
    expect(text).toMatch(/We do not sell your personal information/);
  });

  it("shows a visible marker for every company fact not given yet, never an invented value", () => {
    window.history.replaceState(null, "", "/privacy/");
    render(<App page="privacy" />);
    const marked = [...document.querySelectorAll("[data-missing-fact]")].map((m) => m.getAttribute("data-missing-fact"));
    expect(new Set(marked)).toEqual(new Set(missingFacts()));
    for (const name of missingFacts()) {
      expect(screen.getAllByText(`[preencher: ${MISSING_FACT_LABELS[name]}]`).length).toBeGreaterThan(0);
    }
    // Until the owner gives them, the facts stay empty in the config.
    expect(Object.values(COMPANY).every((v) => v === null)).toBe(true);
  });

  it("switches to Portuguese at /pt/privacy/ and back to /privacy/", async () => {
    window.history.replaceState(null, "", "/privacy/");
    render(<App page="privacy" />);
    await userEvent.click(screen.getByRole("button", { name: /Português/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Política de Privacidade" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/pt/privacy/");
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(document.title).toBe(legalMeta.privacy.pt.title);
    expect(screen.getByRole("link", { name: "Dinequora, início" })).toHaveAttribute("href", "/pt/");
    await userEvent.click(screen.getByRole("button", { name: /English/ }));
    expect(window.location.pathname).toBe("/privacy/");
  });

  it("has the same sections in English and Portuguese", () => {
    expect(privacyPolicy.pt.sections.map((s) => s.id)).toEqual(privacyPolicy.en.sections.map((s) => s.id));
  });
});

describe("legal page head (built HTML)", () => {
  const site = "https://dinequora.com";
  const english = englishIndexHtml(readFileSync(resolve(process.cwd(), "index.html"), "utf8"), site);
  const head = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const attr = (sel: string, name: string) => doc.querySelector(sel)?.getAttribute(name) ?? null;
    return {
      lang: doc.documentElement.getAttribute("lang"),
      title: doc.title,
      description: attr('meta[name="description"]', "content"),
      ogTitle: attr('meta[property="og:title"]', "content"),
      ogDescription: attr('meta[property="og:description"]', "content"),
      canonical: [...doc.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute("href")),
      alternates: [...doc.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => `${l.getAttribute("hreflang")} ${l.getAttribute("href")}`),
      imagePreload: doc.querySelector('link[rel="preload"][as="image"]'),
      jsonLd: doc.querySelector('script[type="application/ld+json"]'),
    };
  };

  it("English: its own title, description, canonical /privacy/, no home-page extras", () => {
    const h = head(legalIndexHtml(english, site, "privacy", "en"));
    expect(h.lang).toBe("en-US");
    expect(h.title).toBe(legalMeta.privacy.en.title);
    expect(h.description).toBe(legalMeta.privacy.en.description);
    expect(h.ogTitle).toBe(legalMeta.privacy.en.title);
    expect(h.ogDescription).toBe(legalMeta.privacy.en.description);
    expect(h.canonical).toEqual(["https://dinequora.com/privacy/"]);
    expect(h.alternates).toEqual([
      "en-US https://dinequora.com/privacy/",
      "pt-BR https://dinequora.com/pt/privacy/",
      "x-default https://dinequora.com/privacy/",
    ]);
    expect(h.imagePreload).toBeNull();
    expect(h.jsonLd).toBeNull();
  });

  it("Portuguese: pt-BR, Portuguese metadata, canonical /pt/privacy/", () => {
    const h = head(legalIndexHtml(english, site, "privacy", "pt"));
    expect(h.lang).toBe("pt-BR");
    expect(h.title).toBe(legalMeta.privacy.pt.title);
    expect(h.description).toBe(legalMeta.privacy.pt.description);
    expect(h.canonical).toEqual(["https://dinequora.com/pt/privacy/"]);
    expect(h.alternates).toEqual(head(legalIndexHtml(english, site, "privacy", "en")).alternates);
  });

  it("also builds without VITE_SITE_URL (no canonical)", () => {
    const local = englishIndexHtml(readFileSync(resolve(process.cwd(), "index.html"), "utf8"), "");
    expect(head(legalIndexHtml(local, "", "privacy", "pt")).canonical).toEqual([]);
  });

  it("keeps legal descriptions within 155 characters", () => {
    for (const locale of ["en", "pt"] as const) expect(legalMeta.privacy[locale].description.length).toBeLessThanOrEqual(155);
  });
});
