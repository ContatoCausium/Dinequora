import { render, within } from "@testing-library/react";
import { App } from "../App";

// The state after the restaurant app is published: VITE_APP_LINKS_ENABLED=true.
vi.mock("../config/site", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/site")>();
  return { ...actual, appRoutes: { login: "https://app.example.test/auth", signup: "https://app.example.test/signup" } };
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

describe("app links once the application is published", () => {
  it("restores Login and Create account links in the header, mobile menu and footer", () => {
    window.history.replaceState(null, "", "/");
    const { container } = render(<App initialLocale="en" />);
    expect(container.querySelectorAll('[data-app-link="unavailable"]')).toHaveLength(0);
    const header = container.querySelector("header")!;
    expect(within(header).getByRole("link", { name: "Login" })).toHaveAttribute("href", "https://app.example.test/auth");
    expect(container.querySelector('#mobile-menu a[href="https://app.example.test/auth"]')).not.toBeNull();
    const footer = container.querySelector("footer")!;
    expect(within(footer).getByRole("link", { name: "Login" })).toHaveAttribute("href", "https://app.example.test/auth");
    expect(within(footer).getByRole("link", { name: "Create account" })).toHaveAttribute("href", "https://app.example.test/signup");
  });
});
