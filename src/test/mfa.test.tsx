import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";

/**
 * Two-step verification (TOTP): Settings > Security links and removes an authenticator; the
 * authenticated gate sends an aal1 session of an account with an authenticator to /mfa. The real
 * Supabase flow (enroll, wrong code refused, confirm, remove) was checked in the browser against a
 * disposable stack with TOTP enabled.
 */
const mfa = vi.hoisted(() => ({
  assurance: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  confirmEnrollment: vi.fn(),
  verify: vi.fn(),
  remove: vi.fn(),
}));
const authMock = vi.hoisted(() => ({ getUser: vi.fn(), signOut: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  auth: { ...authMock, mfa },
  sessionPersistence: { expired: () => false },
}));

import { AuthError } from "@/lib/auth";
import { SecurityPage } from "@/components/pages/security-page";
import { Route as AuthenticatedRoute } from "@/routes/_authenticated/route";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
beforeEach(() => {
  for (const f of Object.values(mfa)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
});
afterEach(cleanup);

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SecurityPage />
    </QueryClientProvider>,
  );

describe("Settings > Security", () => {
  it("links an authenticator: QR and key shown, a wrong code explained, the right one turns it on", async () => {
    mfa.listFactors.mockResolvedValue([]);
    mfa.enroll.mockResolvedValue({
      factorId: "f1",
      qrCode: "data:image/svg+xml;base64,AA==",
      secret: "ABCDEF234567",
    });
    mfa.confirmEnrollment
      .mockRejectedValueOnce(new AuthError("invalid_code"))
      .mockResolvedValueOnce(undefined);
    renderPage();
    const turnOn = await screen.findByRole("button", { name: "Turn on two-step verification" });
    await waitFor(() => expect(turnOn).toBeEnabled());
    fireEvent.click(turnOn);
    expect(
      await screen.findByRole("img", { name: "QR code to link the authenticator app" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ABCDEF234567")).toBeInTheDocument();
    const field = screen.getByLabelText("Code from the app");
    fireEvent.change(field, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and turn on" }));
    expect(await screen.findByText("Enter the 6 digits shown in your app.")).toBeInTheDocument();
    expect(mfa.confirmEnrollment).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and turn on" }));
    expect(
      await screen.findByText("That code is not valid or has expired. Try the current one."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and turn on" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Two-step verification is on."));
    expect(mfa.confirmEnrollment).toHaveBeenLastCalledWith("f1", "123456");
  });

  it("shows a linked authenticator and removes it after confirmation", async () => {
    mfa.listFactors.mockResolvedValue([
      { id: "f1", name: "Authenticator app", verified: true, createdAt: "2026-11-27T12:00:00Z" },
    ]);
    mfa.remove.mockResolvedValue(undefined);
    renderPage();
    expect(
      await screen.findByText("On: each sign-in also asks for a code from your app."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove authenticator" }));
    await waitFor(() => expect(mfa.remove).toHaveBeenCalledWith("f1"));
  });
});

describe("authenticated gate", () => {
  const beforeLoad = AuthenticatedRoute.options.beforeLoad as unknown as (ctx: {
    location: { href: string };
  }) => Promise<unknown>;

  it("sends a password-only session of an account with an authenticator to /mfa", async () => {
    authMock.getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.test",
      emailVerified: true,
      fullName: null,
    });
    mfa.assurance.mockResolvedValue({ current: "aal1", next: "aal2" });
    await expect(beforeLoad({ location: { href: "/tables" } })).rejects.toMatchObject({
      options: { to: "/mfa", search: { redirect: "/tables" } },
    });
  });

  it("lets in a verified session, and an account without an authenticator", async () => {
    authMock.getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.test",
      emailVerified: true,
      fullName: null,
    });
    mfa.assurance.mockResolvedValue({ current: "aal2", next: "aal2" });
    await expect(beforeLoad({ location: { href: "/" } })).resolves.toMatchObject({
      user: { id: "u1" },
    });
    mfa.assurance.mockResolvedValue({ current: "aal1", next: "aal1" });
    await expect(beforeLoad({ location: { href: "/" } })).resolves.toMatchObject({
      user: { id: "u1" },
    });
  });
});
