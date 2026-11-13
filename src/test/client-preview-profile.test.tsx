import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";

/**
 * Client preview (build profile VITE_DEPLOYMENT_PROFILE=client-preview): accounts are provisioned, so
 * public sign-up does not exist (no link on sign-in or invitation screens, /signup goes back to
 * sign-in, no social buttons), and the presentation-mode showcase is never available. The standard
 * profile keeps today's behaviour. The profile is a build-time value; vi.stubEnv stands in for it.
 * Auth, organization data and the router are mocked; nothing reaches a backend.
 */
const nav = vi.hoisted(() => ({ search: {} as Record<string, unknown>, token: "tok-1" }));
const workspace = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const orgService = vi.hoisted(() => ({ getInvitation: vi.fn(), acceptInvitation: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => nav.search,
    useParams: () => ({ token: nav.token }),
  }),
  createRootRouteWithContext: () => (options: Record<string, unknown>) => options,
  HeadContent: () => null,
  Scripts: () => null,
  Outlet: () => null,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() }, state: { location: { href: "/auth" } } }),
  useRouterState: () => ({ location: { pathname: "/auth" } }),
  redirect: (opts: unknown) => ({ isRedirect: true, opts }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  auth: {
    getUser: async () => null,
    onChange: () => () => {},
    resendVerification: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  },
}));
vi.mock("@/lib/admin-service", () => ({ isPlatformAdmin: async () => false }));
vi.mock("@/lib/org-service", () => orgService);
vi.mock("@/components/app/workspace-context", () => ({
  useWorkspace: () => workspace.current,
}));

import { parseDeploymentProfile, isClientPreview } from "@/lib/deployment-profile";
import { Route as AuthRoute } from "@/routes/auth";
import { Route as SignupRoute } from "@/routes/signup";
import { Route as InviteRoute } from "@/routes/invite.$token";
import { Route as RootRoute } from "@/routes/__root";
import { usePresentationMode } from "@/components/app/use-presentation-mode";
import { presentationKey, startPresentation, stopPresentation } from "@/lib/presentation-mode";

const PREVIEW = () => vi.stubEnv("VITE_DEPLOYMENT_PROFILE", "client-preview");
const STANDARD = () => vi.stubEnv("VITE_DEPLOYMENT_PROFILE", "");
type RouteWith = { component: () => ReactNode; beforeLoad?: () => void; head?: () => unknown };
const component = (r: unknown) => (r as RouteWith).component;

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  nav.search = {};
  orgService.getInvitation.mockResolvedValue({
    status: "pending",
    email: "invitee@example.test",
    role: "staff",
    org_name: "Demo Org",
    brand_primary: "#16707a",
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  stopPresentation();
});

describe("deployment profile", () => {
  it("is standard when unset, empty or 'standard'", () => {
    for (const raw of [undefined, "", "  ", "standard", "STANDARD"])
      expect(parseDeploymentProfile(raw)).toBe("standard");
  });
  it("is client-preview for 'client-preview' and fails closed for any other value", () => {
    for (const raw of ["client-preview", "Client-Preview", "client_preview", "preview", "yes"])
      expect(parseDeploymentProfile(raw)).toBe("client-preview");
  });
  it("reads the build-time variable", () => {
    STANDARD();
    expect(isClientPreview()).toBe(false);
    PREVIEW();
    expect(isClientPreview()).toBe(true);
  });
});

describe("public sign-up", () => {
  it("standard: the sign-in screen offers account creation", () => {
    STANDARD();
    const Page = component(AuthRoute);
    render(<Page />);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("client preview: the sign-in screen has no sign-up link at all", () => {
    PREVIEW();
    const Page = component(AuthRoute);
    const { container } = render(<Page />);
    expect(screen.queryByText("Create an account")).toBeNull();
    expect(screen.queryByText("New to Dinequora?")).toBeNull();
    expect(container.querySelector('a[href="/signup"]')).toBeNull();
    // Sign-in itself and password recovery stay available.
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(container.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it("client preview: /signup redirects to sign-in before rendering", () => {
    PREVIEW();
    const beforeLoad = (SignupRoute as unknown as RouteWith).beforeLoad!;
    expect(() => beforeLoad()).toThrow();
    try {
      beforeLoad();
    } catch (e) {
      expect(e).toEqual({ isRedirect: true, opts: { to: "/auth" } });
    }
  });

  it("standard: /signup still loads", () => {
    STANDARD();
    expect(() => (SignupRoute as unknown as RouteWith).beforeLoad!()).not.toThrow();
  });

  it("invitation screen: 'create account to join' only in the standard profile", async () => {
    STANDARD();
    const Page = component(InviteRoute);
    render(<Page />);
    await waitFor(() => expect(screen.getByText("Sign in to join")).toBeInTheDocument());
    expect(screen.getByText("Create account to join")).toBeInTheDocument();
    cleanup();

    PREVIEW();
    const { container } = render(<Page />);
    await waitFor(() => expect(screen.getByText("Sign in to join")).toBeInTheDocument());
    expect(screen.queryByText("Create account to join")).toBeNull();
    expect(container.querySelector('a[href="/signup"]')).toBeNull();
  });
});

describe("no-index meta", () => {
  const robots = () =>
    ((RootRoute as unknown as RouteWith).head!() as { meta: Record<string, string>[] }).meta.find(
      (m) => m["name"] === "robots",
    );
  it("client preview: the document asks robots not to index", () => {
    PREVIEW();
    expect(robots()?.["content"]).toBe("noindex, nofollow, noarchive");
  });
  it("standard: no robots meta is added", () => {
    STANDARD();
    expect(robots()).toBeUndefined();
  });
});

describe("presentation mode", () => {
  const setWorkspace = (fictional: boolean) => {
    workspace.current = {
      user: { id: "user-1" },
      org: { id: "org_preview_demo", fictional },
    };
  };

  it("standard: offered to demo-classified organizations", () => {
    STANDARD();
    setWorkspace(true);
    const { result } = renderHook(() => usePresentationMode());
    expect(result.current.available).toBe(true);
    act(() => startPresentation(presentationKey("user-1", "org_preview_demo")));
    expect(result.current.active).toBe(true);
  });

  it("client preview: never available and never active, even if started programmatically", () => {
    PREVIEW();
    setWorkspace(true);
    const { result } = renderHook(() => usePresentationMode());
    expect(result.current.available).toBe(false);
    act(() => startPresentation(presentationKey("user-1", "org_preview_demo")));
    expect(result.current.active).toBe(false);
    act(() => result.current.start());
    expect(result.current.active).toBe(false);
  });
});
