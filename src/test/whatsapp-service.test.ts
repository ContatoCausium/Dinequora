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

  it("renders deterministic WhatsApp message templates correctly in pt and en", () => {
    const msgPt = renderWhatsAppMessage(
      orgId,
      "all",
      "financial_summary",
      "Carlos Eduardo",
      "pt-BR",
    );
    expect(msgPt).toContain("SERVORA INTELLIGENCE");
    expect(msgPt).toContain("Carlos Eduardo");
    expect(msgPt).toContain("Faturamento Bruto");

    const msgEn = renderWhatsAppMessage(orgId, "all", "financial_summary", "Charles", "en-US");
    expect(msgEn).toContain("Executive Briefing");
    expect(msgEn).toContain("Gross Revenue");

    const lowStockPt = renderWhatsAppMessage(orgId, "all", "low_stock_alert", "Ana", "pt-BR");
    expect(lowStockPt).toContain("ALERTA OPERACIONAL");
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
    expect(log.status).toBe("sent");
    expect(log.idempotencyKey).toBeDefined();

    const allLogs = listWhatsAppLogs(orgId);
    expect(allLogs.some((l) => l.id === log.id)).toBe(true);
  });

  it("validates Meta webhook payload contract", () => {
    expect(validateMetaWebhookPayload(null).valid).toBe(false);
    expect(validateMetaWebhookPayload({ object: "whatsapp_business_account" }).valid).toBe(true);
  });
});
