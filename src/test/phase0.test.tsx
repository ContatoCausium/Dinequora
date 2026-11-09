import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revenueSeries, operationalAlerts, topItems } from "@/lib/demo-data";
import { ORGANIZATIONS } from "@/lib/tenants";
import { validateHours, type WeeklyHours } from "@/lib/access-rules";
import { requestErrorKind } from "@/lib/request-error";
import { useControlData } from "@/components/control/use-control-data";
const mocks = vi.hoisted(() => ({ orgs: vi.fn(), plans: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/admin-service", () => ({
  listOrgInsights: mocks.orgs,
  listPlans: mocks.plans,
  listPlatformAudit: mocks.audit,
}));
beforeEach(() => {
  mocks.orgs.mockReset().mockResolvedValue([]);
  mocks.plans.mockReset().mockResolvedValue([]);
  mocks.audit.mockReset().mockResolvedValue([]);
});
describe("Phase 0 regressions", () => {
  it("F01: zero locations never create a chart or location-bound alerts", () => {
    expect(revenueSeries([], 30)).toEqual([]);
    expect(operationalAlerts([])).toEqual([]);
  });
  it("F11: a fictional restaurant without products yields an empty result", () => {
    const org = ORGANIZATIONS[0];
    if (!org) throw new Error("fixture missing");
    expect(topItems({ ...org, topItems: [] }, org.locations)).toEqual([]);
  });
  it("F07: equal intervals are rejected", () => {
    expect(validateHours({ mon: { open: "09:00", close: "09:00" } })).toEqual(["mon"]);
  });
  it("F07: malformed time is rejected", () => {
    expect(validateHours({ mon: { open: "25:00", close: "09:00" } })).toEqual(["mon"]);
  });
  it("F07: overnight is accepted", () => {
    expect(validateHours({ mon: { open: "22:00", close: "02:00" } })).toEqual([]);
  });
  it("F07: unknown days and malformed values are rejected", () => {
    expect(
      validateHours({ bad: null, mon: { open: 9, close: "10:00" } } as unknown as WeeklyHours),
    ).toEqual(["bad", "mon"]);
  });
  it("F22: failure ends loading, does not masquerade as empty, and retry recovers", async () => {
    mocks.orgs.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useControlData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network");
    expect(result.current.data).toBeNull();
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data?.orgs).toEqual([]);
  });
  it("F22: unauthorized and backend errors remain distinct", () => {
    expect(requestErrorKind(new Error("forbidden"))).toBe("forbidden");
    expect(requestErrorKind({ code: "42501" })).toBe("forbidden");
    expect(requestErrorKind(new Error("internal failure"))).toBe("backend");
  });
});
