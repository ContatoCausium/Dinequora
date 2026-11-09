import { useState, useMemo, useEffect, useCallback } from "react";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { CalendarClock, History, PlugZap, Users } from "lucide-react";
import { toast } from "sonner";
import { fetchOperationalWhatsApp, saveOperationalRecord } from "@/lib/operational.functions";
import {
  renderWhatsAppMessage,
  type WhatsAppContact,
  type WhatsAppMessageLog,
  type RecipientRole,
} from "@/lib/whatsapp-service";
import type { IntelligenceSummary } from "@/lib/intelligence-service";
import { fmtDateTime } from "@/lib/format";
import { useWorkspace } from "@/components/app/workspace-context";
import { Panel, Segmented } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TEMPLATE_KINDS = [
  "financial_summary",
  "revenue_pulse",
  "cmv_audit",
  "low_stock_alert",
  "waste_alert",
  "multi_store_comparison",
] as const;
const PREVIEW_TEMPLATES = ["financial_summary", "cmv_audit", "low_stock_alert"] as const;
type PreviewTemplate = (typeof PREVIEW_TEMPLATES)[number];
const ROLES = ["owner", "manager", "financial_lead", "chef"] as const;
const TABS = ["preview", "schedules", "contacts", "history", "connection"] as const;

const contactPayload = z.object({
  name: z.string(),
  phone: z.string(),
  role: z.enum(ROLES),
  optInDate: z.string(),
  consentGranted: z.literal(true),
  active: z.boolean(),
});
const messagePayload = z.object({
  recipientName: z.string(),
  recipientPhone: z.string(),
  renderedText: z.string(),
  templateKind: z.enum(TEMPLATE_KINDS),
});

/**
 * Simulated WhatsApp center. No provider is connected: previews render the same recorded summary
 * the Intelligence page shows, and tests are saved as drafts only (the RPC rejects sent/delivered).
 */
export function WhatsAppPreviewCard({
  summary,
  periodDays,
  scopeLabel,
}: {
  summary: IntelligenceSummary;
  periodDays: number;
  scopeLabel: string;
}) {
  const { t, i18n } = useTranslation("intelligence");
  const lng = i18n.language;
  const { org, role } = useWorkspace();
  const canManage = role === "owner";

  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [logs, setLogs] = useState<WhatsAppMessageLog[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<PreviewTemplate>("financial_summary");
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactRole, setNewContactRole] = useState<RecipientRole>("owner");

  const reloadRecords = useCallback(async () => {
    const rows = await fetchOperationalWhatsApp({ data: { orgId: org.id } });
    setContacts(
      rows
        .filter((r) => r.kind === "contact")
        .map((r) => {
          const p = contactPayload.parse(r.payload);
          return {
            id: r.id,
            orgId: org.id,
            name: p.name,
            phone: p.phone,
            role: p.role,
            locationIds: [],
            optInConsent: true,
            optInDate: p.optInDate,
            active: p.active,
          };
        }),
    );
    setLogs(
      rows
        .filter((r) => r.kind === "message")
        .map((r) => ({
          id: r.id,
          ...messagePayload.parse(r.payload),
          status: "draft" as const,
          isDemo: true,
          createdAt: r.created_at,
          idempotencyKey: r.id,
        })),
    );
  }, [org.id]);

  useEffect(() => {
    setContacts([]);
    setLogs([]);
    if (canManage) void reloadRecords().catch(() => toast.error(t("operations:failed")));
  }, [canManage, reloadRecords, t]);

  const recipient = contacts.find((c) => c.active && c.optInConsent);
  const recipientName = recipient?.name ?? t("whatsapp.sampleRecipient");

  const renderedPreview = useMemo(
    () => renderWhatsAppMessage({ summary, template, recipientName, lng, periodDays, scopeLabel }),
    [summary, template, recipientName, lng, periodDays, scopeLabel],
  );

  const handleSaveTest = async () => {
    if (!recipient || !canManage || busy) return;
    setBusy(true);
    try {
      await saveOperationalRecord({
        data: {
          orgId: org.id,
          kind: "whatsapp",
          payload: {
            kind: "message",
            recipientName: recipient.name,
            recipientPhone: recipient.phone,
            templateKind: template,
            renderedText: renderedPreview,
            status: "draft",
            isSimulation: true,
          },
        },
      });
      await reloadRecords();
      toast.success(t("whatsapp.testSaved"));
    } catch {
      toast.error(t("operations:failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactName.trim() || !newContactPhone.trim()) {
      toast.error(t("whatsapp.contactRequired"));
      return;
    }
    if (!consent || !canManage || busy) return;
    setBusy(true);
    try {
      await saveOperationalRecord({
        data: {
          orgId: org.id,
          kind: "whatsapp",
          payload: {
            kind: "contact",
            name: newContactName.trim(),
            phone: newContactPhone.trim(),
            role: newContactRole,
            consentGranted: true,
            optInDate: new Date().toISOString(),
            active: true,
          },
        },
      });
      await reloadRecords();
    } catch {
      toast.error(t("operations:failed"));
      return;
    } finally {
      setBusy(false);
    }
    setNewContactName("");
    setNewContactPhone("");
    setConsent(false);
    toast.success(t("whatsapp.contactSaved"));
  };

  const ownerOnly = <p className="text-xs text-muted-foreground">{t("whatsapp.ownerOnly")}</p>;

  return (
    <Panel
      title={t("whatsapp.title")}
      subtitle={t("whatsapp.subtitle")}
      action={
        <Badge variant="warning" className="shrink-0">
          {t("whatsapp.simulation")}
        </Badge>
      }
      className="self-start"
    >
      <Tabs defaultValue="preview">
        <TabsList aria-label={t("whatsapp.tabsLabel")} className="h-auto flex-wrap justify-start">
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} className="text-xs">
              {t(`whatsapp.tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="preview" className="mt-4 space-y-4">
          <Segmented<PreviewTemplate>
            label={t("whatsapp.templateLabel")}
            value={template}
            onChange={setTemplate}
            options={PREVIEW_TEMPLATES.map((k) => ({
              value: k,
              label: t(`whatsapp.templates.${k}`),
            }))}
          />

          <div className="rounded-xl border bg-muted/40 p-4">
            <div className="whitespace-pre-wrap rounded-lg border bg-card p-3 text-xs leading-relaxed">
              {renderedPreview}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("whatsapp.recipient", { name: recipientName })}</span>
              <span>{t("whatsapp.notSent")}</span>
            </div>
          </div>

          {canManage ? (
            <div className="space-y-2">
              <Button
                className="w-full"
                disabled={!recipient || busy}
                aria-busy={busy}
                onClick={() => void handleSaveTest()}
              >
                {t("whatsapp.saveTest")}
              </Button>
              {!recipient && (
                <p className="text-xs text-muted-foreground">{t("whatsapp.saveTestHint")}</p>
              )}
            </div>
          ) : (
            ownerOnly
          )}
        </TabsContent>

        <TabsContent value="schedules" className="mt-4">
          <EmptyState
            icon={<CalendarClock className="size-5" strokeWidth={1.75} />}
            title={t("whatsapp.schedulesEmptyTitle")}
            body={t("whatsapp.schedulesEmptyBody")}
          />
        </TabsContent>

        <TabsContent value="contacts" className="mt-4 space-y-4">
          {!canManage ? (
            ownerOnly
          ) : (
            <>
              {contacts.length === 0 ? (
                <EmptyState
                  icon={<Users className="size-5" strokeWidth={1.75} />}
                  title={t("whatsapp.contactsEmptyTitle")}
                  body={t("whatsapp.contactsEmptyBody")}
                />
              ) : (
                <ul className="divide-y rounded-md border">
                  {contacts.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="tabular text-xs text-muted-foreground">
                          {c.phone} · {t(`whatsapp.roles.${c.role}`)}
                        </p>
                      </div>
                      <Badge variant="success" className="shrink-0">
                        {t("whatsapp.consentRecorded")}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={handleAddContact} className="space-y-3 rounded-md border p-4">
                <p className="text-sm font-medium">{t("whatsapp.addContact")}</p>
                <div className="grid grid-cols-1 gap-2">
                  <Input
                    aria-label={t("whatsapp.contactName")}
                    placeholder={t("whatsapp.contactName")}
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    className="h-9"
                  />
                  <Input
                    aria-label={t("whatsapp.contactPhone")}
                    placeholder={t("whatsapp.contactPhone")}
                    type="tel"
                    value={newContactPhone}
                    onChange={(e) => setNewContactPhone(e.target.value)}
                    className="h-9"
                  />
                  <select
                    aria-label={t("whatsapp.contactRole")}
                    value={newContactRole}
                    onChange={(e) => setNewContactRole(e.target.value as RecipientRole)}
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`whatsapp.roles.${r}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  {t("operations:consent")}
                </label>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={!consent || busy}
                  aria-busy={busy}
                >
                  {t("whatsapp.addContact")}
                </Button>
              </form>
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {!canManage ? (
            ownerOnly
          ) : logs.length === 0 ? (
            <EmptyState
              icon={<History className="size-5" strokeWidth={1.75} />}
              title={t("whatsapp.historyEmptyTitle")}
              body={t("whatsapp.historyEmptyBody")}
            />
          ) : (
            <ul className="divide-y rounded-md border">
              {logs.map((log) => (
                <li key={log.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{log.recipientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`whatsapp.templates.${log.templateKind}`)} ·{" "}
                      {fmtDateTime(log.createdAt, lng)}
                    </p>
                  </div>
                  <Badge variant="neutral" className="shrink-0">
                    {t("whatsapp.draft")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="connection" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <PlugZap className="size-4 text-muted-foreground" aria-hidden />
            <Badge variant="warning">{t("whatsapp.connectionStatus")}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t("whatsapp.connectionBody")}</p>
          <p className="text-xs text-muted-foreground">{t("whatsapp.connectionPending")}</p>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
