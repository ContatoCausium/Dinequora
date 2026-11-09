import { describe, it, expect } from "vitest";
import {
  getWhatsAppSettings,
  saveWhatsAppSettings,
  listWhatsAppContacts,
  saveWhatsAppContact,
  listWhatsAppSchedules,
  saveWhatsAppSchedule,
  renderWhatsAppMessage,
  listWhatsAppLogs,
  queueSimulatedSend,
  validateMetaWebhookPayload,
  type WhatsAppContact,
  type WhatsAppScheduleConfig,
} from "@/lib/whatsapp-service";
import type { IntelligenceSummary } from "@/lib/intelligence-service";

describe("Servora Intelligence — WhatsApp Service", () => {
  const orgId = "org-test-wa-123";

  it("initializes default WhatsApp settings in demo mode without exposing secrets", () => {
    const settings = getWhatsAppSettings(orgId);
    expect(settings.orgId).toBe(orgId);
    expect(settings.isDemoMode).toBe(true);
    expect(settings.status).toBe("demo_mode");
    expect(settings.businessPhoneNumber).toContain("+55");
  });

  it("updates WhatsApp settings safely", () => {
    const current = getWhatsAppSettings(orgId);
    const updated = saveWhatsAppSettings({
      ...current,
      businessPhoneNumber: "+55 (11) 99999-8888",
    });
    expect(updated.businessPhoneNumber).toBe("+55 (11) 99999-8888");
  });

  it("manages authorized contacts with opt-in status", () => {
    const contacts = listWhatsAppContacts(orgId);
    expect(contacts.length).toBeGreaterThanOrEqual(2);

    const newContact: WhatsAppContact = {
      id: `cnt-${Date.now()}`,
      orgId,
      name: "Gerente de Turno",
      phone: "+55 (11) 97777-6666",
      role: "manager",
      locationIds: [],
      optInConsent: true,
      optInDate: new Date().toISOString(),
      active: true,
    };

    const saved = saveWhatsAppContact(newContact);
    expect(saved.some((c) => c.phone === "+55 (11) 97777-6666")).toBe(true);
  });

  const summary: IntelligenceSummary = {
    grossRevenueCents: 123456,
    netRevenueCents: 50000,
    foodCostCents: 37037,
    cmvRate: 30,
    grossMarginRate: 70,
    operatingExpensesCents: 36419,
    estimatedWasteCents: 0,
    lowStockItemCount: 3,
    activeRecipeCount: 4,
    analyzedOrderCount: 12,
    dataBreakdown: { realTransactionsCount: 20, realOrdersCount: 12, inventoryCount: 9 },
    insights: [],
  };

  it("renders the page summary (cents, not 100x) in the selected language", () => {
    const msgEn = renderWhatsAppMessage({
      summary,
      template: "financial_summary",
      recipientName: "Charles",
      lng: "en-US",
      periodDays: 7,
      scopeLabel: "Downtown",
    });
    expect(msgEn).toContain("Charles");
    expect(msgEn).toContain("Gross revenue: $1,234.56");
    expect(msgEn).toContain("Food cost (COGS): 30%");
    expect(msgEn).toContain("Low-stock items: 3");
    expect(msgEn).toContain("last 7 days (Downtown)");
    expect(msgEn).toContain("not sent");

    const msgPt = renderWhatsAppMessage({
      summary,
      template: "financial_summary",
      recipientName: "Carlos Eduardo",
      lng: "pt-BR",
    });
    expect(msgPt).toContain("Carlos Eduardo");
    expect(msgPt).toContain("Faturamento bruto");
    expect(msgPt).toContain("Todas as lojas");
    expect(msgPt).not.toContain("Gross revenue");

    const lowStockPt = renderWhatsAppMessage({
      summary,
      template: "low_stock_alert",
      recipientName: "Ana",
      lng: "pt-BR",
    });
    expect(lowStockPt).toContain("Alerta de estoque baixo");
    expect(lowStockPt).toContain("3 de 9");
  });

  it("shows no rate when no revenue was recorded", () => {
    const msg = renderWhatsAppMessage({
      summary: { ...summary, grossRevenueCents: 0, cmvRate: 0, grossMarginRate: 0 },
      template: "cmv_audit",
      recipientName: "Ana",
      lng: "en-US",
    });
    expect(msg).toContain("Food cost (COGS): —");
    expect(msg).toContain("$0.00");
  });

  it("handles schedules configuration and pauses", () => {
    const schedules = listWhatsAppSchedules(orgId);
    expect(schedules.length).toBeGreaterThanOrEqual(1);

    const first = schedules[0];
    if (first) {
      const updated = saveWhatsAppSchedule({ ...first, enabled: !first.enabled });
      const found = updated.find((s) => s.id === first.id);
      expect(found?.enabled).toBe(!first.enabled);
    }
  });

  it("queues simulated send and retains idempotency key", () => {
    const log = queueSimulatedSend(orgId, "Diretoria", "+55 (11) 90000-0000", "cmv_audit", "pt-BR");
    expect(log.isDemo).toBe(true);
    expect(log.status).toBe("draft");
    expect(log.idempotencyKey).toBeDefined();

    const allLogs = listWhatsAppLogs(orgId);
    expect(allLogs.some((l) => l.id === log.id)).toBe(true);
  });

  it("validates Meta webhook payload contract", () => {
    expect(validateMetaWebhookPayload(null).valid).toBe(false);
    expect(validateMetaWebhookPayload({ object: "whatsapp_business_account" }).valid).toBe(true);
  });
});
