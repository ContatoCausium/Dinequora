import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";

// The state while the restaurant app is not published (VITE_APP_LINKS_ENABLED unset), fixed here
// so a developer's local .env cannot change what this file checks.
vi.mock("../config/site", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/site")>();
  return { ...actual, appRoutes: null };
});

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

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("Login and Create account while the app is not published", () => {
  it("shows Login and Create account with a Coming soon badge in the header, mobile menu and footer", () => {
    const { container } = render(<App initialLocale="en" />);
    const header = container.querySelector("header")!;
    const items = [...container.querySelectorAll('[data-app-link="unavailable"]')];
    expect(items).toHaveLength(4);
    // Desktop header (P4: the action and its state are both visible).
    const desktop = header.querySelector('.lg\\:flex [data-app-link="unavailable"]')!;
    expect(text(desktop)).toBe("Login, Coming soon");
    // Mobile menu.
    expect(text(container.querySelector('#mobile-menu [data-app-link="unavailable"]')!)).toBe("Login, Coming soon");
    // Footer.
    const footer = container.querySelector("footer")!;
    expect([...footer.querySelectorAll('[data-app-link="unavailable"]')].map(text)).toEqual([
      "Login, Coming soon",
      "Create account, Coming soon",
    ]);
  });

  it("renders them as plain text: no link, no button, no role, no focus (P3)", async () => {
    const user = userEvent.setup();
    const { container } = render(<App initialLocale="en" />);
    for (const el of container.querySelectorAll('[data-app-link="unavailable"]')) {
      expect(el.tagName).toBe("SPAN");
      expect(el.closest("a, button")).toBeNull();
      for (const node of [el, ...el.querySelectorAll("*")]) {
        expect(node.hasAttribute("role"), node.outerHTML).toBe(false);
        expect(node.hasAttribute("tabindex")).toBe(false);
        expect(node.hasAttribute("aria-disabled")).toBe(false);
        expect(node.hasAttribute("aria-hidden")).toBe(false);
        expect(node.hasAttribute("href")).toBe(false);
      }
    }
    expect(screen.queryAllByRole("link", { name: /login|create account|coming soon/i })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /login|create account|coming soon/i })).toHaveLength(0);
    // Walk the whole tab order: focus never lands on (or inside) an unavailable action.
    const focusables = container.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])').length;
    for (let i = 0; i < focusables + 2; i++) {
      await user.tab();
      expect(document.activeElement?.closest('[data-app-link="unavailable"]') ?? null).toBeNull();
    }
  });

  it("has no anchor to the app, its routes, or to the demo form in their place", () => {
    const { container } = render(<App initialLocale="en" />);
    for (const a of container.querySelectorAll("a[href]")) {
      expect(a.getAttribute("href")!, text(a)).not.toMatch(/app\.dinequora\.com|\/auth\b|\/signup\b/);
    }
    const accountColumn = within(container.querySelector("footer")!).getByRole("navigation", { name: "Account" });
    expect(within(accountColumn).queryAllByRole("link")).toHaveLength(0);
  });

  it("is translated in Portuguese", () => {
    const { container } = render(<App initialLocale="pt" />);
    expect([...container.querySelectorAll('[data-app-link="unavailable"]')].map(text)).toEqual([
      "Entrar, Em breve",
      "Entrar, Em breve",
      "Entrar, Em breve",
      "Criar conta, Em breve",
    ]);
  });
});
