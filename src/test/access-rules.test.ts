import { describe, expect, it } from "vitest";
import {
  canAddStore,
  canManageMember,
  countBillableStores,
  invitableRoles,
  validateHours,
} from "@/lib/access-rules";

describe("store limits", () => {
  it("inactive stores do not count toward the plan limit", () => {
    expect(countBillableStores(["active", "placeholder", "inactive"])).toBe(2);
  });
  it("only owners of a running organization below the limit can add stores", () => {
    expect(canAddStore("owner", 2, 3, false)).toBe(true);
    expect(canAddStore("owner", 3, 3, false)).toBe(false);
    expect(canAddStore("manager", 0, 3, false)).toBe(false);
    expect(canAddStore("owner", 0, 3, true)).toBe(false);
  });
});

describe("team scope", () => {
  it("managers manage only staff inside their own stores", () => {
    const mgr = { role: "manager" as const, locationIds: ["a", "b"] };
    expect(canManageMember(mgr, { role: "staff", locationIds: ["a"] })).toBe(true);
    expect(canManageMember(mgr, { role: "staff", locationIds: ["a", "c"] })).toBe(false);
    expect(canManageMember(mgr, { role: "manager", locationIds: ["a"] })).toBe(false);
  });
  it("staff manage nobody and cannot invite", () => {
    expect(
      canManageMember({ role: "staff", locationIds: ["a"] }, { role: "staff", locationIds: ["a"] }),
    ).toBe(false);
    expect(invitableRoles("staff")).toEqual([]);
  });
  it("managers can only invite staff", () => {
    expect(invitableRoles("manager")).toEqual(["staff"]);
  });
});

describe("opening hours", () => {
  it("flags malformed or zero-length days and accepts overnight", () => {
    expect(validateHours({ mon: { open: "11:00", close: "02:00" }, tue: null })).toEqual([]);
    expect(
      validateHours({
        wed: { open: "25:00", close: "10:00" },
        thu: { open: "09:00", close: "09:00" },
      }),
    ).toEqual(["wed", "thu"]);
  });
});
