// Control Center refusal codes (0034): each database refusal reaches the operator as its own code, never
// swallowed by a shorter code it contains ("forbidden" in "self_assignment_forbidden").
import { describe, expect, it, vi } from "vitest";
import { adminErrorCode } from "@/lib/admin-service";
import en from "@/locales/en-US/control.json";
import pt from "@/locales/pt-BR/control.json";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

const CODES = [
  "self_assignment_forbidden",
  "platform_user_forbidden",
  "platform_role_owner_conflict",
  "platform_role_member_conflict",
  "user_ambiguous",
  "user_not_found",
  "owner_exists",
  "isolation_unsupported",
  "reason_required",
  "verification_required",
  "last_admin",
  "not_found",
  "forbidden",
];

describe("adminErrorCode", () => {
  it("maps every refusal to itself, exact or inside a longer database message", () => {
    for (const c of CODES) {
      expect(adminErrorCode(c)).toBe(c);
      expect(adminErrorCode(`ERROR: ${c} (P0001)`)).toBe(c);
    }
  });

  it("never reduces a specific code to a shorter one it contains", () => {
    expect(adminErrorCode("self_assignment_forbidden")).not.toBe("forbidden");
    expect(adminErrorCode("platform_user_forbidden")).not.toBe("forbidden");
    expect(adminErrorCode("user_not_found")).not.toBe("not_found");
  });

  it("anything else is unknown", () => {
    expect(adminErrorCode("connection reset")).toBe("unknown");
  });

  it("every code has a message in both languages", () => {
    for (const c of CODES) {
      expect(en.errors, c).toHaveProperty(c);
      expect(pt.errors, c).toHaveProperty(c);
    }
  });
});
