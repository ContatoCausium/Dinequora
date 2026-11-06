// ponytail: in-memory state until Meta Cloud API backend function connects. Upgrade path: public.whatsapp_* supabase tables.
import { computeIntelligenceSummary } from "./intelligence-service";
import { fmtCurrency, fmtPercent } from "./format";

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

export function renderWhatsAppMessage(
  orgId: string,
  locationId: string,
  template: WhatsAppTemplateKind,
  recipientName: string,
  lng = "pt-BR",
): string {
  const summary = computeIntelligenceSummary(orgId, locationId, 30);
  const isPt = lng.startsWith("pt");

  switch (template) {
    case "financial_summary":
      return isPt
        ? `🍽️ *SERVORA INTELLIGENCE · Resumo Executivo*\n` +
            `Olá, *${recipientName}*! Segue a posição consolidada dos últimos 30 dias:\n\n` +
            `💰 *Faturamento Bruto:* ${fmtCurrency(summary.grossRevenueCents, lng)}\n` +
            `📈 *Faturamento Líquido:* ${fmtCurrency(summary.netRevenueCents, lng)}\n` +
            `🎯 *CMV Médio Real:* *${summary.cmvRate.toFixed(1)}%* (Meta: 31.0%)\n` +
            `📊 *Margem Bruta:* ${summary.grossMarginRate.toFixed(1)}%\n` +
            `⚠️ *Itens em Estoque Crítico:* ${summary.lowStockItemCount}\n\n` +
            `_Relatório gerado automaticamente pelo Servora Intelligence. Ambiente demonstrativo._`
        : `🍽️ *SERVORA INTELLIGENCE · Executive Briefing*\n` +
            `Hello *${recipientName}*! Here is your 30-day performance update:\n\n` +
            `💰 *Gross Revenue:* ${fmtCurrency(summary.grossRevenueCents, lng)}\n` +
            `📈 *Net Revenue:* ${fmtCurrency(summary.netRevenueCents, lng)}\n` +
            `🎯 *Actual Food Cost (COGS):* *${summary.cmvRate.toFixed(1)}%* (Target: 31.0%)\n` +
            `📊 *Gross Margin:* ${summary.grossMarginRate.toFixed(1)}%\n` +
            `⚠️ *Critical Stock Items:* ${summary.lowStockItemCount}\n\n` +
            `_Generated by Servora Intelligence. Simulated dispatch._`;

    case "cmv_audit":
      return isPt
        ? `🔍 *SERVORA AUDIT · Auditoria de CMV e Fichas Técnicas*\n` +
            `Gestor: *${recipientName}*\n\n` +
            `• *CMV Real do Período:* ${summary.cmvRate.toFixed(1)}%\n` +
            `• *Fichas Ativas Analisadas:* ${summary.activeRecipeCount}\n` +
            `• *Perda Estimada em Rupturas/Quebras:* ${fmtCurrency(summary.estimatedWasteCents, lng)}\n\n` +
            `📌 *Diagnóstico:* ${summary.insights[0]?.title || "Fichas alinhadas com as metas operacionais."}\n` +
            `👉 *Ação imediata:* ${summary.insights[0]?.recommendation || "Revisar cotações dos insumos proteicos."}\n\n` +
            `_Servora Intelligence · Dados calculados deterministicamente._`
        : `🔍 *SERVORA AUDIT · Food Cost & Recipe Audit*\n` +
            `Recipient: *${recipientName}*\n\n` +
            `• *Measured COGS Rate:* ${summary.cmvRate.toFixed(1)}%\n` +
            `• *Active Recipes Monitored:* ${summary.activeRecipeCount}\n` +
            `• *Estimated Waste / Loss:* ${fmtCurrency(summary.estimatedWasteCents, lng)}\n\n` +
            `📌 *Finding:* ${summary.insights[0]?.title || "Recipe margins conform to operating standard."}\n` +
            `👉 *Recommended Action:* ${summary.insights[0]?.recommendation || "Review protein supplier contract."}\n\n` +
            `_Servora Intelligence · Deterministic calculation._`;

    case "low_stock_alert":
      return isPt
        ? `🚨 *ALERTA OPERACIONAL · Risco de Ruptura de Estoque*\n` +
            `Atenção *${recipientName}*, detectamos itens com estoque abaixo do mínimo de segurança:\n\n` +
            `• *Itens Críticos:* ${summary.lowStockItemCount} itens em atenção imediata\n` +
            `• *Status de Fornecedores:* US Foods & Sysco com entregas pendentes\n\n` +
            `👉 Abra a Central de Suprimentos para emitir ou adiantar o Pedido de Compra.\n\n` +
            `_Aviso automático Servora Stock Controller._`
        : `🚨 *OPERATIONAL ALERT · Low Inventory Alert*\n` +
            `Attention *${recipientName}*, items reached safety threshold:\n\n` +
            `• *Critical Items:* ${summary.lowStockItemCount} items needing replenishment\n` +
            `• *Suppliers Status:* Pending purchase orders on Sysco & US Foods\n\n` +
            `👉 Open Purchase Orders dashboard to trigger restock.\n\n` +
            `_Automated dispatch by Servora Stock Controller._`;

    case "waste_alert":
    case "revenue_pulse":
    case "multi_store_comparison":
    default:
      return isPt
        ? `📊 *SERVORA · Atualização Operacional*\n` +
            `Olá, *${recipientName}*. Seu resumo de desempenho operacional já está disponível na plataforma.\n` +
            `Faturamento recente: ${fmtCurrency(summary.grossRevenueCents, lng)} · Pedidos: ${summary.dataBreakdown.realOrdersCount}.\n\n` +
            `_Demonstração oficial Servora Intelligence._`
        : `📊 *SERVORA · Operations Pulse*\n` +
            `Hello *${recipientName}*. Your restaurant metrics have been refreshed on the dashboard.\n` +
            `Current Revenue: ${fmtCurrency(summary.grossRevenueCents, lng)} · Orders: ${summary.dataBreakdown.realOrdersCount}.\n\n` +
            `_Simulated WhatsApp Business Meta adapter._`;
  }
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
      renderedText: renderWhatsAppMessage(
        orgId,
        "all",
        "financial_summary",
        "Diretor de Operações (Demo)",
        "pt-BR",
      ),
      status: "sent",
      isDemo: true,
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      sentAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      idempotencyKey: `idemp-${orgId}-001`,
    },
    {
      id: `log-${orgId}-2`,
      recipientName: "Gerente Geral Unidade Matriz",
      recipientPhone: "+55 (11) 99123-5566",
      templateKind: "low_stock_alert",
      renderedText: renderWhatsAppMessage(
        orgId,
        "all",
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
    renderedText: renderWhatsAppMessage(orgId, "all", template, recipientName, lng),
    status: "sent",
    isDemo: true,
    createdAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
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
