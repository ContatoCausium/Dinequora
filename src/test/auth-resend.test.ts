import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseAuth } from "@/lib/auth/supabase-adapter";

const mocks = vi.hoisted(() => ({ resend: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { resend: mocks.resend } } }));
vi.mock("@/integrations/lovable/index", () => ({ lovable: {} }));
beforeEach(() => mocks.resend.mockReset());

describe("confirmation resend", () => {
  it("F05 rejects failed requests instead of reporting acceptance", async () => {
    mocks.resend.mockResolvedValue({ error: { message: "service unavailable", status: 500 } });
    await expect(
      supabaseAuth.resendVerification("fictional@example.invalid"),
    ).rejects.toMatchObject({ code: "backend" });
  });
  it("F05 accepts only a successful request", async () => {
    mocks.resend.mockResolvedValue({ error: null });
    await expect(
      supabaseAuth.resendVerification("fictional@example.invalid"),
    ).resolves.toBeUndefined();
  });
});
