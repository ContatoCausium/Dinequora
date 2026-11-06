import { describe, it, expect, vi } from "vitest";
import { setPlatformRole, listPlatformAdmins } from "@/lib/admin-service";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe("Fase 2.4 - admin_list_platform_admins and admin protections", () => {
  it("returns platform admins matching expected fields (user_id, email, role)", async () => {
    const mockData = [
      {
        user_id: "00000000-0000-0000-0000-000000000001",
        email: "admin@servora.test",
        role: "platform_admin",
      },
      {
        user_id: "00000000-0000-0000-0000-000000000002",
        email: "support@servora.test",
        role: "support",
      },
    ];

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: mockData,
      error: null,
    } as any);

    const result = await listPlatformAdmins();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      user_id: "00000000-0000-0000-0000-000000000001",
      email: "admin@servora.test",
      role: "platform_admin",
    });
    expect(result[1]?.role).toBe("support");
  });

  it("prevents revoking the sole remaining platform_admin", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [
        {
          user_id: "00000000-0000-0000-0000-000000000001",
          email: "lastadmin@servora.test",
          role: "platform_admin",
        },
        {
          user_id: "00000000-0000-0000-0000-000000000002",
          email: "support@servora.test",
          role: "support",
        },
      ],
      error: null,
    } as any);

    await expect(
      setPlatformRole("lastadmin@servora.test", "platform_admin", false, "Cleanup temporary admin"),
    ).rejects.toThrow("last_admin");
  });

  it("allows revoking admin when multiple platform_admins exist", async () => {
    vi.mocked(supabase.rpc)
      // 1st call for listing admins:
      .mockResolvedValueOnce({
        data: [
          {
            user_id: "00000000-0000-0000-0000-000000000001",
            email: "admin1@servora.test",
            role: "platform_admin",
          },
          {
            user_id: "00000000-0000-0000-0000-000000000002",
            email: "admin2@servora.test",
            role: "platform_admin",
          },
        ],
        error: null,
      } as any)
      // 2nd call executing rpc admin_set_platform_role:
      .mockResolvedValueOnce({
        data: null,
        error: null,
      } as any);

    await expect(
      setPlatformRole("admin2@servora.test", "platform_admin", false, "Deprovisioning account"),
    ).resolves.not.toThrow();
  });

  it("denies non-admin execution when RPC returns forbidden", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: "forbidden" },
    } as any);

    await expect(listPlatformAdmins()).rejects.toThrow("forbidden");
  });

  it("validates that setPlatformRole enforces reason minimum length", async () => {
    await expect(setPlatformRole("test@servora.test", "support", true, "  ")).rejects.toThrow(
      "reason_required",
    );
  });

  it("allows support role assignment with valid justification", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: null,
    } as any);

    await expect(
      setPlatformRole("support@servora.test", "support", true, "Support operations onboard"),
    ).resolves.not.toThrow();
  });
});
