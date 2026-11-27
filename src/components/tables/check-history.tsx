import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CheckEvent } from "@/lib/check-history";
import { fmtDate, fmtDateTime, fmtMoneyCents } from "@/lib/format";
import { localDay, shiftDay } from "@/lib/store-time";
import { FormSelect } from "@/components/ui/form-select";
import { fetchCheckHistory, fetchClosedChecksToday } from "@/lib/operational.functions";

const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

/** The timeline of one check: who opened it, sent each round, voided, paid, reversed, and when. */
export function CheckHistoryDialog({
  orgId,
  storeId,
  checkId,
  title,
  onClose,
}: {
  orgId: string;
  storeId: string;
  /** null keeps the dialog closed. */
  checkId: string | null;
  title: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("tables");
  const money = (c: number) => fmtMoneyCents(c, i18n.language);
  const q = useQuery({
    queryKey: ["check-history", orgId, storeId, checkId],
    queryFn: () => fetchCheckHistory({ data: { orgId, locationId: storeId, checkId: checkId! } }),
    enabled: checkId !== null,
    staleTime: 0,
  });
  const otherName = (e: CheckEvent) =>
    e.other
      ? (e.other.label ?? t("check.checkN", { n: e.other.number }))
      : t("history.anotherCheck");
  const line = (e: CheckEvent): string => {
    const method = e.method ? t(`pay.methods.${e.method}`, { defaultValue: e.method }) : "";
    switch (e.kind) {
      case "opened":
        return t("history.opened");
      case "round_fired":
        return t("history.roundFired", { n: e.roundNo, amount: money(e.amountCents ?? 0) });
      case "round_voided":
        return t("history.roundVoided", { n: e.roundNo });
      case "round_moved_in":
        return t("history.roundMovedIn", { check: otherName(e) });
      case "round_moved_out":
        return t("history.roundMovedOut", { check: otherName(e) });
      case "paid":
        return e.tipCents
          ? t("history.paidWithTip", {
              amount: money(e.amountCents ?? 0),
              method,
              tip: money(e.tipCents),
            })
          : t("history.paid", { amount: money(e.amountCents ?? 0), method });
      case "payment_reversed":
        return t("history.reversed", { amount: money(e.amountCents ?? 0), method });
      case "closed":
        return t("history.closed");
      case "voided":
        return t("history.voided");
    }
  };
  return (
    <Dialog open={checkId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("history.title", { check: title })}</DialogTitle>
          <DialogDescription>{t("history.hint")}</DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <p className="text-sm text-muted-foreground">{t("history.loading")}</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("history.error")}
          </p>
        ) : (
          <ol
            aria-label={t("history.listLabel")}
            className="max-h-[60vh] space-y-2 overflow-y-auto"
          >
            {q.data.map((e, i) => (
              <li key={i} className="flex gap-3 text-[13px]">
                <time dateTime={e.at} className="w-12 shrink-0 tabular-nums text-muted-foreground">
                  {fmtDateTime(e.at, i18n.language, TIME)}
                </time>
                <span>
                  <span className={e.kind === "payment_reversed" ? "text-destructive" : undefined}>
                    {line(e)}
                  </span>
                  {e.actor && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {t("history.by", { name: e.actor })}
                    </span>
                  )}
                  {e.reason && (
                    <span className="block text-muted-foreground">
                      {t("history.reason", { reason: e.reason })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Checks closed today at this store, each with its history: the record outlives the table. */
export function ClosedChecksDialog({
  orgId,
  storeId,
  open,
  onClose,
}: {
  orgId: string;
  storeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("tables");
  const money = (c: number) => fmtMoneyCents(c, i18n.language);
  const [historyOf, setHistoryOf] = useState<{ id: string; title: string } | null>(null);
  /** Empty = today (the store's day, decided by the server). */
  const [day, setDay] = useState("");
  /** The 13 days before today (the viewer's calendar; the server clamps to the store's own days). */
  const recentDays = useMemo(() => {
    const today = localDay(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    return Array.from({ length: 13 }, (_, i) => shiftDay(today, -(i + 1)));
  }, []);
  const q = useQuery({
    queryKey: ["dining-closed-today", orgId, storeId, day],
    queryFn: () =>
      fetchClosedChecksToday({
        data: { orgId, locationId: storeId, ...(day ? { day } : {}) },
      }),
    enabled: open,
    staleTime: 0,
  });
  return (
    <>
      <Dialog open={open && historyOf === null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {day
                ? t("history.closedTitleDay", {
                    day: fmtDate(day, i18n.language, { day: "numeric", month: "short" }),
                  })
                : t("history.closedTitle")}
            </DialogTitle>
            <DialogDescription>{t("history.closedHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-[13px]">
            <span aria-hidden>{t("history.dayLabel")}</span>
            <FormSelect
              aria-label={t("history.dayLabel")}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              size="sm"
            >
              <option value="">{t("history.today")}</option>
              {recentDays.map((d) => (
                <option key={d} value={d}>
                  {fmtDate(d, i18n.language, { weekday: "short", day: "numeric", month: "short" })}
                </option>
              ))}
            </FormSelect>
          </div>
          {q.isPending ? (
            <p className="text-sm text-muted-foreground">{t("history.closedLoading")}</p>
          ) : q.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("history.error")}
            </p>
          ) : q.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {day ? t("history.closedEmptyDay") : t("history.closedEmpty")}
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {q.data.map((c) => {
                const name = c.label ?? t("check.checkN", { n: c.number });
                const title = c.tableLabel ? `${c.tableLabel} · ${name}` : name;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 py-2 text-[13px]"
                  >
                    <span>
                      <span className="font-medium">{title}</span>
                      <span className="block text-muted-foreground">
                        {fmtDateTime(c.closedAt, i18n.language, TIME)} · {money(c.paidCents)}
                        {c.tipsCents > 0 && ` · ${t("pay.tipOf", { tip: money(c.tipsCents) })}`}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("history.openFor", { check: title })}
                      onClick={() => setHistoryOf({ id: c.id, title })}
                    >
                      <History aria-hidden />
                      {t("history.open")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <CheckHistoryDialog
        orgId={orgId}
        storeId={storeId}
        checkId={open ? (historyOf?.id ?? null) : null}
        title={historyOf?.title ?? ""}
        onClose={() => setHistoryOf(null)}
      />
    </>
  );
}
