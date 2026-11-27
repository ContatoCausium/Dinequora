import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { englishIndexHtml, legalIndexHtml } from "../build/seo";
import { legalMeta } from "../i18n/meta";
import { PENDING_RULES, termsOfUse } from "../legal/terms";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  window.history.replaceState(null, "", "/terms/");
});

const mainText = () => document.querySelector("main")!.textContent!.replace(/\s+/g, " ");

describe("terms of use page", () => {
  it("renders with its own title, every section and a link to the privacy policy", () => {
    render(<App page="terms" />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of Use" })).toBeInTheDocument();
    expect(document.title).toBe(legalMeta.terms.en.title);
    for (const section of termsOfUse.en.sections) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
    }
    expect(within(document.querySelector("main")!).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy/");
  });

  it("states the approved cancellation, refund and governing-law rules (2026-11-17)", () => {
    render(<App page="terms" />);
    const text = mainText();
    expect(text).toContain("You can cancel at any time. Your access continues until the end of the month you paid for. We do not give prorated refunds.");
    expect(text).toContain("there is no refund if you cancel in the middle of the period. Your access continues until the end of the period you paid for.");
    expect(text).toContain("It is non-refundable once implementation has started.");
    expect(text).toContain("governed by the laws of the Commonwealth of Massachusetts");
    expect(text).toContain("courts located in Massachusetts");
  });

  it("shows the approved prices, read from the same source as the Pricing section", () => {
    render(<App page="terms" />);
    const text = mainText();
    expect(text).toContain("Starter: $69 per month, plus a $149 implementation fee.");
    expect(text).toContain("Growth: $119 per month, plus a $399.99 implementation fee.");
    expect(text).toContain("implementation fee from $799. Up to 50 locations, subject to contract.");
    expect(text).toContain("with 8% off the subscription");
    expect(text).toContain("with 15% off the subscription");
    expect(text).toContain("The implementation fee is charged once and is never discounted.");
  });

  it("marks the rules not decided yet instead of inventing them", () => {
    render(<App page="terms" />);
    const pending = [...document.querySelectorAll("[data-pending-rule]")].map((m) => m.getAttribute("data-pending-rule"));
    expect(new Set(pending)).toEqual(new Set(Object.values(PENDING_RULES)));
    expect(mainText()).not.toMatch(/auto-?renew|12 months preceding|aggregate liability/i);
  });

  it("switches to Portuguese at /pt/terms/ with the same rules and prices", async () => {
    render(<App page="terms" />);
    await userEvent.click(screen.getByRole("button", { name: /Português/ }));
    expect(window.location.pathname).toBe("/pt/terms/");
    expect(screen.getByRole("heading", { level: 1, name: "Termos de Uso" })).toBeInTheDocument();
    const text = mainText();
    expect(text).toContain("Starter: US$ 69 por mês, mais taxa de implantação de US$ 149.");
    expect(text).toContain("Não fazemos reembolso proporcional.");
    expect(text).toContain("Massachusetts");
    expect(within(document.querySelector("main")!).getByRole("link", { name: "Política de Privacidade" })).toHaveAttribute("href", "/pt/privacy/");
  });

  it("has the same sections in English and Portuguese", () => {
    expect(termsOfUse.pt.sections.map((s) => s.id)).toEqual(termsOfUse.en.sections.map((s) => s.id));
  });

  it("is linked from the footer of every page", () => {
    window.history.replaceState(null, "", "/");
    render(<App />);
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "/terms/");
  });

  it("has its own head: title, description, canonical /terms/ and /pt/terms/", () => {
    const english = englishIndexHtml(readFileSync(resolve(process.cwd(), "index.html"), "utf8"), "https://dinequora.com");
    for (const locale of ["en", "pt"] as const) {
      const doc = new DOMParser().parseFromString(legalIndexHtml(english, "https://dinequora.com", "terms", locale), "text/html");
      expect(doc.title).toBe(legalMeta.terms[locale].title);
      expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(legalMeta.terms[locale].description);
      expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`https://dinequora.com${locale === "pt" ? "/pt" : ""}/terms/`);
      expect(legalMeta.terms[locale].description.length).toBeLessThanOrEqual(155);
    }
  });
});
