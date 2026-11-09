// ponytail: in-memory state until Meta Cloud API backend function connects. Upgrade path: public.whatsapp_* supabase tables.
import i18n from "./i18n";
import { computeIntelligenceSummary, type IntelligenceSummary } from "./intelligence-service";
import { fmtMoneyCents, fmtNumber, fmtPercent } from "./format";

export type WhatsAppConnectionStatus =
  "disconnected" | "pending_verification" | "connected" | "demo_mode";
export type WhatsAppReportFrequency = "daily" | "weekly" | "monthly";
export type WhatsAppTemplateKind =
  | "financial_summary"
  | "revenue_pulse"
  | "cmv_audit"
  | "low_stock_alert"
  | "waste_alert"
  | "multi_store_comparison";
export type WhatsAppDeliveryStatus = "draft" | "scheduled" | "sent" | "failed";
export type RecipientRole = "owner" | "manager" | "financial_lead" | "chef";

export interface WhatsAppContact {
  id: string;
  name: string;
  phone: string;
  role: RecipientRole;
  orgId: string;
  locationIds: string[]; // empty = all
  optInConsent: boolean;
  optInDate: string;
  active: boolean;
}

export interface WhatsAppScheduleConfig {
  id: string;
  orgId: string;
  title: string;
  templateKind: WhatsAppTemplateKind;
  frequency: WhatsAppReportFrequency;
  scheduledTime: string; // HH:mm
  scheduledDays?: number[]; // 0-6 for weekly or 1-31 for monthly
  locationIds: string[];
  recipientIds: string[];
  enabled: boolean;
  includeSimulation: boolean;
}

export interface WhatsAppMessageLog {
  id: string;
  scheduleId?: string;
  recipientName: string;
  recipientPhone: string;
  templateKind: WhatsAppTemplateKind;
  renderedText: string;
  status: WhatsAppDeliveryStatus;
  isDemo: boolean;
  createdAt: string;
  sentAt?: string;
  failureReason?: string;
  idempotencyKey: string;
}

export interface WhatsAppBusinessSettings {
  orgId: string;
  businessPhoneNumber: string;
  phoneNumberId: string; // Meta Cloud API reference (mocked/non-sensitive)
  wabaId: string; // WhatsApp Business Account ID
  status: WhatsAppConnectionStatus;
  webhookVerified: boolean;
  defaultLanguage: "pt-BR" | "en-US";
  isDemoMode: boolean;
}

// Default settings store
const settingsMap = new Map<string, WhatsAppBusinessSettings>();
const contactsMap = new Map<string, WhatsAppContact[]>();
const schedulesMap = new Map<string, WhatsAppScheduleConfig[]>();
const messageLogsMap = new Map<string, WhatsAppMessageLog[]>();

export function getWhatsAppSettings(orgId: string): WhatsAppBusinessSettings {
  const existing = settingsMap.get(orgId);
  if (existing) return existing;
  const initial: WhatsAppBusinessSettings = {
    orgId,
    businessPhoneNumber: "+55 (11) 4004-9800",
    phoneNumberId: "waba_phone_demo_9921",
    wabaId: "waba_acc_demo_88301",
    status: "demo_mode",
    webhookVerified: true,
    defaultLanguage: "pt-BR",
    isDemoMode: true,
  };
  settingsMap.set(orgId, initial);
  return initial;
}

export function saveWhatsAppSettings(settings: WhatsAppBusinessSettings): WhatsAppBusinessSettings {
  settingsMap.set(settings.orgId, { ...settings });
  return settings;
}

export function listWhatsAppContacts(orgId: string): WhatsAppContact[] {
  const list = contactsMap.get(orgId);
  if (list) return list;
  const seed: WhatsAppContact[] = [
    {
      id: `cnt-${orgId}-1`,
      name: "Diretor de Operações (Demo)",
      phone: "+55 (11) 98765-4321",
      role: "owner",
      orgId,
      locationIds: [],
      optInConsent: true,
      optInDate: "2025-01-15T10:00:00Z",
      active: true,
    },
    {
      id: `cnt-${orgId}-2`,
      name: "Gerente Geral Unidade Matriz",
      phone: "+55 (11) 99123-5566",
      role: "manager",
      orgId,
      locationIds: [],
      optInConsent: true,
      optInDate: "2025-02-01T14:30:00Z",
      active: true,
    },
  ];
  contactsMap.set(orgId, seed);
  return seed;
}

export function saveWhatsAppContact(contact: WhatsAppContact): WhatsAppContact[] {
  const current = listWhatsAppContacts(contact.orgId);
  const idx = current.findIndex((c) => c.id === contact.id);
  let updated: WhatsAppContact[];
  if (idx >= 0) {
    updated = current.map((c) => (c.id === contact.id ? contact : c));
  } else {
    updated = [contact, ...current];
  }
  contactsMap.set(contact.orgId, updated);
  return updated;
}

export function listWhatsAppSchedules(orgId: string): WhatsAppScheduleConfig[] {
  const list = schedulesMap.get(orgId);
  if (list) return list;
  const seed: WhatsAppScheduleConfig[] = [
    {
      id: `sch-${orgId}-1`,
      orgId,
      title: "Resumo Executivo Diário Matinal",
      templateKind: "financial_summary",
      frequency: "daily",
      scheduledTime: "08:30",
      locationIds: [],
      recipientIds: [`cnt-${orgId}-1`],
      enabled: true,
      includeSimulation: false,
    },
    {
      id: `sch-${orgId}-2`,
      orgId,
      title: "Auditoria Semanal de CMV & Fichas",
      templateKind: "cmv_audit",
      frequency: "weekly",
      scheduledTime: "20:00",
      scheduledDays: [0], // Domingo
      locationIds: [],
      recipientIds: [`cnt-${orgId}-1`, `cnt-${orgId}-2`],
      enabled: true,
      includeSimulation: false,
    },
  ];
  schedulesMap.set(orgId, seed);
  return seed;
}

export function saveWhatsAppSchedule(schedule: WhatsAppScheduleConfig): WhatsAppScheduleConfig[] {
  const current = listWhatsAppSchedules(schedule.orgId);
  const idx = current.findIndex((s) => s.id === schedule.id);
  let updated: WhatsAppScheduleConfig[];
  if (idx >= 0) {
    updated = current.map((s) => (s.id === schedule.id ? schedule : s));
  } else {
    updated = [schedule, ...current];
  }
  schedulesMap.set(schedule.orgId, updated);
  return updated;
}

export interface WhatsAppRenderInput {
  /** The same summary the Intelligence page shows (recorded data for the active scope). */
  summary: IntelligenceSummary;
  template: WhatsAppTemplateKind;
  recipientName: string;
  lng: string;
  periodDays?: number | undefined;
  /** Store name, or the localized "All stores" label, shown in the message. */
  scopeLabel?: string | undefined;
}

/** Renders a simulated WhatsApp message in `lng` from an already computed summary. */
export function renderWhatsAppMessage({
  summary,
  template,
  recipientName,
  lng,
  periodDays = 30,
  scopeLabel,
}: WhatsAppRenderInput): string {
  const t = i18n.getFixedT(lng, "intelligence");
  const hasRevenue = summary.grossRevenueCents > 0;
  const noValue = t("message.noValue");
  const values = {
    name: recipientName,
    days: periodDays,
    scope: scopeLabel ?? t("allStores"),
    revenue: fmtMoneyCents(summary.grossRevenueCents, lng),
    net: fmtMoneyCents(summary.netRevenueCents, lng),
    recipeCost: fmtMoneyCents(summary.foodCostCents, lng),
    cmv: hasRevenue ? fmtPercent(summary.cmvRate / 100, lng) : noValue,
    margin: hasRevenue ? fmtPercent(summary.grossMarginRate / 100, lng) : noValue,
    lowStock: fmtNumber(summary.lowStockItemCount, lng),
    tracked: fmtNumber(summary.dataBreakdown.inventoryCount, lng),
    recipes: fmtNumber(summary.activeRecipeCount, lng),
    orders: fmtNumber(summary.dataBreakdown.realOrdersCount, lng),
  };
  const key =
    template === "financial_summary" || template === "cmv_audit" || template === "low_stock_alert"
      ? template
      : "pulse";
  return `${t(`message.${key}`, values)}

${t("message.footer")}`;
}

/** Legacy in-memory demo path: renders from the browser-local demo services. */
function renderLegacyDemoMessage(
  orgId: string,
  template: WhatsAppTemplateKind,
  recipientName: string,
  lng: string,
): string {
  return renderWhatsAppMessage({
    summary: computeIntelligenceSummary(orgId, "all", 30),
    template,
    recipientName,
    lng,
  });
}

export function listWhatsAppLogs(orgId: string): WhatsAppMessageLog[] {
  const list = messageLogsMap.get(orgId);
  if (list) return list;
  const seed: WhatsAppMessageLog[] = [
    {
      id: `log-${orgId}-1`,
      recipientName: "Diretor de Operações (Demo)",
      recipientPhone: "+55 (11) 98765-4321",
      templateKind: "financial_summary",
      renderedText: renderLegacyDemoMessage(
        orgId,
        "financial_summary",
        "Diretor de Operações (Demo)",
        "pt-BR",
      ),
      status: "draft",
      isDemo: true,
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      idempotencyKey: `idemp-${orgId}-001`,
    },
    {
      id: `log-${orgId}-2`,
      recipientName: "Gerente Geral Unidade Matriz",
      recipientPhone: "+55 (11) 99123-5566",
      templateKind: "low_stock_alert",
      renderedText: renderLegacyDemoMessage(
        orgId,
        "low_stock_alert",
        "Gerente Geral Unidade Matriz",
        "pt-BR",
      ),
      status: "scheduled",
      isDemo: true,
      createdAt: new Date(Date.now() - 1800000).toISOString(),
      idempotencyKey: `idemp-${orgId}-002`,
    },
  ];
  messageLogsMap.set(orgId, seed);
  return seed;
}

export function queueSimulatedSend(
  orgId: string,
  recipientName: string,
  recipientPhone: string,
  template: WhatsAppTemplateKind,
  lng = "pt-BR",
): WhatsAppMessageLog {
  const logs = listWhatsAppLogs(orgId);
  const newLog: WhatsAppMessageLog = {
    id: `log-${orgId}-${Date.now()}`,
    recipientName,
    recipientPhone,
    templateKind: template,
    renderedText: renderLegacyDemoMessage(orgId, template, recipientName, lng),
    // No provider is connected: a simulated send is only ever recorded as a draft.
    status: "draft",
    isDemo: true,
    createdAt: new Date().toISOString(),
    idempotencyKey: `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  messageLogsMap.set(orgId, [newLog, ...logs]);
  return newLog;
}

// Webhook Meta validation stub for modular API compatibility
export function validateMetaWebhookPayload(
  body: unknown,
  signatureHeader?: string,
): { valid: boolean; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "payload_empty" };
  }
  // In non-production preview, avoid demanding production app secrets
  return { valid: true };
}
