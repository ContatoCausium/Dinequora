import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";

/**
 * Control Center > organization > Modules. admin_set_org_feature itself (platform admin only,
 * audited, unknown feature refused) is covered by scripts/security/permission_scope_features.sql.
 */
const admin = vi.hoisted(() => ({ listOrgModules: vi.fn(), setOrgModule: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/admin-service", () => admin);
vi.mock("sonner", () => ({ toast }));

import { OrgModules } from "@/components/control/org-modules";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
beforeEach(() => {
  admin.listOrgModules.mockReset();
  admin.setOrgModule.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

const renderIt = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OrgModules orgId="org-1" />
    </QueryClientProvider>,
  );

describe("organization modules", () => {
  it("lists the catalog with each module's state and turns one on", async () => {
    admin.listOrgModules.mockResolvedValue([
      { key: "ai_assistant", description: "Management assistant", enabled: false, isDefault: true },
      { key: "table_service", description: "Dining room", enabled: true, isDefault: false },
    ]);
    admin.setOrgModule.mockResolvedValue(undefined);
    renderIt();
    const ai = await screen.findByRole("switch", { name: "AI assistant for this organization" });
    const tables = screen.getByRole("switch", { name: "Tables and checks for this organization" });
    expect(ai).toHaveAttribute("aria-checked", "false");
    expect(tables).toHaveAttribute("aria-checked", "true");
    fireEvent.click(ai);
    await waitFor(() =>
      expect(admin.setOrgModule).toHaveBeenCalledWith("org-1", "ai_assistant", true),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("AI assistant turned on."));
    expect(admin.listOrgModules.mock.calls.length).toBeGreaterThan(1);
  });

  it("reports a refused change and keeps the list", async () => {
    admin.listOrgModules.mockResolvedValue([
      { key: "table_service", description: "Dining room", enabled: true, isDefault: false },
    ]);
    admin.setOrgModule.mockRejectedValue(new Error("forbidden"));
    renderIt();
    fireEvent.click(
      await screen.findByRole("switch", { name: "Tables and checks for this organization" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The change was not saved. Try again."),
    );
  });

  it("an unknown module still shows, by its key", async () => {
    admin.listOrgModules.mockResolvedValue([
      { key: "new_thing", description: "Something new", enabled: false, isDefault: true },
    ]);
    renderIt();
    expect(
      await screen.findByRole("switch", { name: "new_thing for this organization" }),
    ).toBeInTheDocument();
  });
});
