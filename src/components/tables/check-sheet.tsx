import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  ChefHat,
  History,
  Printer,
  Minus,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { CheckPayment } from "@/components/tables/check-payment";
import { CheckHistoryDialog } from "@/components/tables/check-history";
import { useWorkspace } from "@/components/app/workspace-context";
import { checkBillHtml, printHtml } from "@/lib/check-bill";

import { OrderStatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime, fmtMoneyCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  diningErrorKey,
  draftCents,
  draftLineCents,
  roundTaxCents,
  type DiningRoom,
  type DiningTable,
  type DraftLine,
  type OpenSession,
  type SessionCheck,
} from "@/lib/dining-room";
import {
  changeOperationalOrder,
  closeEmptyDiningSession,
  fetchOperationalMenu,
  fireCheckRound,
  moveCheckRound,
  moveDiningSession,
  openDiningCheck,
  openDiningSession,
  updateDiningSession,
} from "@/lib/operational.functions";

type MenuItem = Awaited<ReturnType<typeof fetchOperationalMenu>>["items"][number];
type ModifierGroup = MenuItem["modifierGroups"][number];

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Seat a party at a free (or reserved) table. The key is created once per dialog: a retry after a
 * lost reply returns the same session. */
export function SeatDialog({
  table,
  orgId,
  storeId,
  onClose,
  onSeated,
}: {
  table: DiningTable | null;
  orgId: string;
  storeId: string;
  onClose: () => void;
  onSeated: (tableId: string) => void;
}) {
  const { t } = useTranslation("tables");
  const [guests, setGuests] = useState("2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  useEffect(() => {
    if (table) {
      setGuests(String(Math.min(table.seats, 2)));
      setError(null);
      key.current = newKey();
    }
  }, [table]);

  async function submit() {
    if (!table) return;
    const n = Number(guests);
    if (!Number.isInteger(n) || n < 1 || n > 99) return setError(t("errors.invalid_guests"));
    setBusy(true);
    setError(null);
    try {
      await openDiningSession({
        data: { orgId, locationId: storeId, tableId: table.id, guests: n, clientKey: key.current },
      });
      toast.success(t("check.seated", { label: table.label, count: n }));
      onSeated(table.id);
    } catch (e) {
      setError(t(`errors.${diningErrorKey(e)}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={table !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("check.seatTitle", { label: table?.label ?? "" })}</DialogTitle>
          <DialogDescription>{t("check.seatHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="dining-guests">{t("check.guests")}</Label>
            <Input
              id="dining-guests"
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
              autoFocus
              required
              aria-invalid={error !== null}
              aria-describedby={error ? "dining-seat-error" : undefined}
            />
          </div>
          {error && (
            <p id="dining-seat-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("form.saving") : t("check.seat")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Options of a product with modifier groups (same rules the server checks: required, min, max). */
function ModifierDialog({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem | null;
  onClose: () => void;
  onAdd: (line: Omit<DraftLine, "key">) => void;
}) {
  const { t, i18n } = useTranslation("tables");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPicked({});
    setNotes("");
    setError(null);
  }, [item]);
  const min = (g: ModifierGroup) => Math.max(g.minSelections, g.required ? 1 : 0);
  const toggle = (g: ModifierGroup, optionId: string) =>
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      if (cur.includes(optionId)) return { ...p, [g.id]: cur.filter((x) => x !== optionId) };
      if (g.maxSelections === 1) return { ...p, [g.id]: [optionId] };
      if (cur.length >= g.maxSelections) return p;
      return { ...p, [g.id]: [...cur, optionId] };
    });
  function add() {
    if (!item) return;
    const missing = item.modifierGroups.find((g) => (picked[g.id] ?? []).length < min(g));
    if (missing) return setError(t("check.modifierMissing", { group: missing.name }));
    onAdd({
      productId: item.id,
      name: item.name,
      unitPriceCents: item.priceCents,
      quantity: 1,
      notes: notes.trim(),
      modifiers: item.modifierGroups.flatMap((g) =>
        (picked[g.id] ?? []).map((optionId) => {
          const o = g.options.find((x) => x.id === optionId)!;
          return { groupId: g.id, optionId, name: o.name, priceCents: o.priceCents };
        }),
      ),
    });
  }
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item?.name}</DialogTitle>
          <DialogDescription>{t("check.modifierHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {item?.modifierGroups.map((g) => (
            <fieldset key={g.id} className="space-y-2">
              <legend className="text-sm font-medium">
                {g.name}
                <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                  {min(g) > 0 ? t("check.required") : t("check.optional")}
                  {g.maxSelections > 1 ? ` · ${t("check.upTo", { count: g.maxSelections })}` : ""}
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {g.options.map((o) => {
                  const on = (picked[g.id] ?? []).includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(g, o.id)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on
                          ? "border-primary bg-primary-soft"
                          : "bg-card hover:border-foreground/25",
                      )}
                    >
                      {o.name}
                      {o.priceCents > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          +{fmtMoneyCents(o.priceCents, i18n.language)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="dining-item-notes">{t("check.itemNotes")}</Label>
            <Input
              id="dining-item-notes"
              value={notes}
              maxLength={200}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button onClick={add}>{t("check.addItem")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The checks of an open table. A table may have several (each person or group its own bill): one is
 * selected at a time and shows its rounds already sent to the kitchen, its total and the next round
 * being prepared for it. Session actions: guests, another check, move, close when there is nothing
 * to pay. Paying a check is the next step: totals are shown, nothing is charged here.
 */
export function CheckSheet({
  session,
  room,
  orgId,
  storeId,
  drafts,
  setDraftFor,
  can,
  onClose,
  reload,
}: {
  session: OpenSession | null;
  room: DiningRoom;
  orgId: string;
  storeId: string;
  /** Rounds being prepared, per check id. */
  drafts: Record<string, DraftLine[]>;
  setDraftFor: (checkId: string, lines: DraftLine[]) => void;
  can: { serve: boolean; sell: boolean; refund: boolean };
  onClose: () => void;
  reload: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation(["tables", "orders"]);
  const money = (c: number) => fmtMoneyCents(c, i18n.language);
  const { org } = useWorkspace();
  /** The check as a printed bill (pre-bill or after a partial payment), from a hidden iframe. */
  const printBill = (c: SessionCheck) => {
    if (!session) return;
    const tableLabel = room.tables.find((x) => x.id === session.tableId)?.label ?? "";
    printHtml(
      checkBillHtml({
        lang: i18n.language,
        restaurant: org.name,
        store: org.locations.find((l) => l.id === storeId)?.name ?? "",
        tableLabel,
        checkName: c.label ?? t("check.checkN", { n: c.number }),
        guests: session.guests,
        serverName: session.serverName,
        check: c,
        money,
        printedAt: fmtDateTime(new Date().toISOString(), i18n.language),
        labels: {
          title: t("bill.title", { label: tableLabel }),
          table: t("bill.table"),
          check: t("bill.check"),
          guests: t("bill.guests"),
          server: t("bill.server"),
          round: t("bill.round"),
          subtotal: t("bill.subtotal"),
          tax: t("bill.tax"),
          total: t("bill.total"),
          paid: t("bill.paid"),
          balance: t("bill.balance"),
          tipTitle: t("bill.tipTitle"),
          tipLine: (percent, tip, total) => t("bill.tipLine", { percent, tip, total }),
          thanks: t("bill.thanks"),
          printedAt: t("bill.printedAt"),
        },
      }),
    );
  };
  const table = room.tables.find((x) => x.id === session?.tableId) ?? null;
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [menuError, setMenuError] = useState(false);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");
  const [moving, setMoving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [guests, setGuests] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [moveRound, setMoveRound] = useState<string | null>(null);
  const [moveRoundTo, setMoveRoundTo] = useState("");
  const [newCheck, setNewCheck] = useState<string | null>(null);
  const newCheckKey = useRef(newKey());
  const check = session?.checks.find((c) => c.id === activeId) ?? session?.checks[0] ?? null;
  const draft = check ? (drafts[check.id] ?? []) : [];
  const setDraft = (lines: DraftLine[]) => check && setDraftFor(check.id, lines);
  const checkName = (c: { number: number; label: string | null }) =>
    c.label ?? t("check.checkN", { n: c.number });
  // One key per round being prepared: kept across retries until the round is recorded.
  const fireKey = useRef<string | null>(null);

  useEffect(() => {
    if (!session || menu) return;
    let active = true;
    fetchOperationalMenu({ data: { orgId } })
      .then((m) => {
        if (active)
          setMenu(
            m.items.filter(
              (i) => i.active && (i.locationIds.length === 0 || i.locationIds.includes(storeId)),
            ),
          );
      })
      .catch(() => active && setMenuError(true));
    return () => {
      active = false;
    };
  }, [session, menu, orgId, storeId]);
  useEffect(() => {
    setError(null);
    setNotes("");
    setQuery("");
    setActiveId(null);
  }, [session?.id]);
  useEffect(() => {
    fireKey.current = null;
  }, [check?.id]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (menu ?? []).filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, 60);
  }, [menu, query]);
  const freeTables = room.tables.filter(
    (x) =>
      x.id !== session?.tableId &&
      (x.status === "available" || x.status === "reserved") &&
      !room.sessions.some((s) => s.tableId === x.id),
  );

  const addLine = (line: Omit<DraftLine, "key">) => {
    fireKey.current = null;
    const same = draft.find(
      (l) =>
        l.productId === line.productId &&
        l.notes === line.notes &&
        JSON.stringify(l.modifiers) === JSON.stringify(line.modifiers),
    );
    setDraft(
      same
        ? draft.map((l) => (l === same ? { ...l, quantity: Math.min(1000, l.quantity + 1) } : l))
        : [...draft, { ...line, key: newKey() }],
    );
  };
  const setQty = (key: string, quantity: number) => {
    fireKey.current = null;
    setDraft(
      quantity <= 0
        ? draft.filter((l) => l.key !== key)
        : draft.map((l) => (l.key === key ? { ...l, quantity: Math.min(1000, quantity) } : l)),
    );
  };

  async function sendRound() {
    if (!session || !check || draft.length === 0) return;
    if (room.taxRatePpm === null) return setError(t("errors.tax_rate_not_configured"));
    fireKey.current ??= newKey();
    setBusy("fire");
    setError(null);
    try {
      await fireCheckRound({
        data: {
          orgId,
          locationId: storeId,
          checkId: check.id,
          clientKey: fireKey.current,
          taxRatePpm: room.taxRatePpm,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          items: draft.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            ...(l.notes ? { notes: l.notes } : {}),
            modifiers: l.modifiers.map((m) => ({ groupId: m.groupId, optionId: m.optionId })),
          })),
        },
      });
      toast.success(
        session.checks.length > 1
          ? t("check.sentTo", { label: table?.label ?? "", check: checkName(check) })
          : t("check.sent", { label: table?.label ?? "" }),
      );
      fireKey.current = null;
      setDraft([]);
      setNotes("");
    } catch (e) {
      // A refusal wrote nothing; the same key is kept so a retry after a lost reply is not a second round.
      setError(t(`errors.${diningErrorKey(e)}`));
    } finally {
      await reload();
      setBusy(null);
    }
  }

  async function run(label: string, fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      toast.success(ok);
      after?.();
    } catch (e) {
      setError(t(`errors.${diningErrorKey(e)}`));
    } finally {
      await reload();
      setBusy(null);
    }
  }

  const subtotal = draftCents(draft);
  const tax = room.taxRatePpm === null ? 0 : roundTaxCents(subtotal, room.taxRatePpm);

  return (
    <>
      <Sheet open={session !== null} onOpenChange={(open) => !open && busy === null && onClose()}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
        >
          {session && table && (
            <>
              <SheetHeader className="border-b px-5 py-4 text-left">
                <SheetTitle>{t("check.title", { label: table.label })}</SheetTitle>
                <SheetDescription>
                  {t("check.summary", {
                    count: session.guests,
                    server: session.serverName ?? t("check.serverUnknown"),
                  })}
                </SheetDescription>
                <div className="flex flex-wrap gap-2 pt-1">
                  {can.serve && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setGuests(String(session.guests))}
                      >
                        {t("check.editGuests")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={freeTables.length === 0}
                        onClick={() => {
                          setMoveTo(freeTables[0]?.id ?? "");
                          setMoving(true);
                        }}
                      >
                        {t("check.move")}
                      </Button>
                      {session.liveRounds === 0 && (
                        <Button variant="outline" size="sm" onClick={() => setConfirmClose(true)}>
                          {t("check.closeEmpty")}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </SheetHeader>

              <div className="border-b px-5 py-3">
                <div
                  role="group"
                  aria-label={t("check.checksLabel")}
                  className="flex flex-wrap items-center gap-2"
                >
                  {session.checks.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={c.id === check?.id}
                      onClick={() => setActiveId(c.id)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        c.id === check?.id
                          ? "border-primary bg-primary-soft font-medium"
                          : "bg-card hover:border-foreground/25",
                      )}
                    >
                      {checkName(c)}
                      <span className="ml-1.5 tabular-nums text-muted-foreground">
                        {money(c.liveTotalCents)}
                      </span>
                      {(drafts[c.id]?.length ?? 0) > 0 && (
                        <span className="sr-only">, {t("check.hasDraft")}</span>
                      )}
                    </button>
                  ))}
                  {can.serve && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        newCheckKey.current = newKey();
                        setNewCheck("");
                      }}
                    >
                      <Plus aria-hidden />
                      {t("check.newCheck")}
                    </Button>
                  )}
                </div>
                {session.checks.length === 1 && can.serve && (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">{t("check.splitHint")}</p>
                )}
              </div>

              <div className="flex-1 space-y-6 px-5 py-4">
                {error && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {error}
                  </p>
                )}

                <section aria-labelledby="check-rounds">
                  <h3 id="check-rounds" className="mb-2 text-sm font-semibold">
                    {t("check.sentTitle")}
                  </h3>
                  {!check || check.rounds.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("check.noRounds")}</p>
                  ) : (
                    <ol className="space-y-3">
                      {check.rounds.map((r) => (
                        <li
                          key={r.orderId}
                          className={cn(
                            "rounded-lg border p-3",
                            r.status === "cancelled" && "opacity-60",
                          )}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium">
                              {t("check.round", { n: r.roundNo })}
                            </span>
                            <span className="flex items-center gap-2">
                              <OrderStatusBadge
                                status={r.status}
                                label={t(`orders:statuses.${r.status}`, { defaultValue: r.status })}
                              />
                              {can.serve &&
                                r.status !== "cancelled" &&
                                session.checks.length > 1 &&
                                check &&
                                check.paidCents === 0 && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t("check.moveRound", { n: r.roundNo })}
                                    onClick={() => {
                                      setMoveRound(r.orderId);
                                      setMoveRoundTo(
                                        session.checks.find((c) => c.id !== check.id)?.id ?? "",
                                      );
                                    }}
                                  >
                                    <ArrowRightLeft aria-hidden />
                                  </Button>
                                )}
                              {can.refund &&
                                r.status !== "cancelled" &&
                                check &&
                                check.paidCents === 0 && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t("check.voidRound", { n: r.roundNo })}
                                    onClick={() => setVoidTarget(r.orderId)}
                                  >
                                    <Trash2 aria-hidden />
                                  </Button>
                                )}
                            </span>
                          </div>
                          <ul className="space-y-0.5 text-[13px]">
                            {r.items.map((i, n) => (
                              <li key={n} className="flex justify-between gap-3">
                                <span>
                                  {i.quantity} × {i.name}
                                  {i.modifiers.length > 0 && (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · {i.modifiers.join(", ")}
                                    </span>
                                  )}
                                </span>
                                <span className="tabular-nums">{money(i.subtotalCents)}</span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="mt-3 flex justify-between text-sm font-semibold">
                    <span>
                      {session.checks.length > 1 && check
                        ? t("check.totalOf", { check: checkName(check) })
                        : t("check.totalSoFar")}
                    </span>
                    <span className="tabular-nums">{money(check?.liveTotalCents ?? 0)}</span>
                  </p>
                  {session.checks.length > 1 && (
                    <p className="mt-1 flex justify-between text-[13px] text-muted-foreground">
                      <span>{t("check.tableTotal")}</span>
                      <span className="tabular-nums">{money(session.liveTotalCents)}</span>
                    </p>
                  )}
                  {check && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {check.liveRounds > 0 && (
                        <Button variant="outline" size="sm" onClick={() => printBill(check)}>
                          <Printer aria-hidden />
                          {t("bill.print")}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setHistoryOf(check.id)}>
                        <History aria-hidden />
                        {t("history.open")}
                      </Button>
                    </div>
                  )}
                </section>

                {check && check.liveRounds > 0 && (
                  <CheckPayment
                    key={check.id}
                    check={check}
                    orgId={orgId}
                    storeId={storeId}
                    can={{ sell: can.sell, serve: can.serve, refund: can.refund }}
                    reload={reload}
                    onSettled={() => setActiveId(null)}
                  />
                )}

                {can.serve && (
                  <section aria-labelledby="check-next" className="space-y-3">
                    <h3 id="check-next" className="text-sm font-semibold">
                      {session.checks.length > 1 && check
                        ? t("check.nextTitleFor", { check: checkName(check) })
                        : t("check.nextTitle")}
                    </h3>
                    {draft.length > 0 && (
                      <ul className="space-y-2">
                        {draft.map((l) => (
                          <li key={l.key} className="flex items-center gap-2 text-[13px]">
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{l.name}</span>
                              {l.modifiers.length > 0 && (
                                <span className="block text-muted-foreground">
                                  {l.modifiers.map((m) => m.name).join(", ")}
                                </span>
                              )}
                              {l.notes && (
                                <span className="block text-muted-foreground">“{l.notes}”</span>
                              )}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label={t("check.less", { name: l.name })}
                              onClick={() => setQty(l.key, l.quantity - 1)}
                            >
                              <Minus aria-hidden />
                            </Button>
                            <span className="w-6 text-center tabular-nums" aria-live="polite">
                              {l.quantity}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label={t("check.more", { name: l.name })}
                              onClick={() => setQty(l.key, l.quantity + 1)}
                            >
                              <Plus aria-hidden />
                            </Button>
                            <span className="w-20 text-right tabular-nums">
                              {money(draftLineCents(l))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <Input
                        aria-label={t("check.searchMenu")}
                        placeholder={t("check.searchMenu")}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                    {menuError ? (
                      <p className="text-sm text-destructive">{t("check.menuError")}</p>
                    ) : menu === null ? (
                      <p className="text-sm text-muted-foreground">{t("check.menuLoading")}</p>
                    ) : (
                      <ul className="grid grid-cols-2 gap-2">
                        {shown.map((i) => (
                          <li key={i.id}>
                            <button
                              type="button"
                              onClick={() =>
                                i.modifierGroups.length > 0
                                  ? setPicking(i)
                                  : addLine({
                                      productId: i.id,
                                      name: i.name,
                                      unitPriceCents: i.priceCents,
                                      quantity: 1,
                                      notes: "",
                                      modifiers: [],
                                    })
                              }
                              className="flex h-full w-full flex-col items-start rounded-lg border bg-card px-3 py-2 text-left text-[13px] hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="font-medium">{i.name}</span>
                              <span className="text-muted-foreground">{money(i.priceCents)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="dining-round-notes">{t("check.roundNotes")}</Label>
                      <Textarea
                        id="dining-round-notes"
                        rows={2}
                        maxLength={500}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                  </section>
                )}
              </div>

              {can.serve && (
                <div className="sticky bottom-0 border-t bg-background px-5 py-3">
                  <div className="mb-2 flex justify-between text-[13px] text-muted-foreground">
                    <span>{t("check.roundEstimate")}</span>
                    <span className="tabular-nums">
                      {money(subtotal)} + {money(tax)}
                    </span>
                  </div>
                  <Button
                    className="w-full"
                    disabled={draft.length === 0 || busy !== null || !can.sell}
                    onClick={() => void sendRound()}
                  >
                    <ChefHat aria-hidden />
                    {busy === "fire"
                      ? t("check.sending")
                      : t("check.send", { count: draft.reduce((n, l) => n + l.quantity, 0) })}
                  </Button>
                  {!can.sell && (
                    <p className="mt-1.5 text-[12px] text-muted-foreground">
                      {t("check.needSell")}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <CheckHistoryDialog
        orgId={orgId}
        storeId={storeId}
        checkId={session ? historyOf : null}
        title={(() => {
          const c = session?.checks.find((x) => x.id === historyOf);
          const table = room.tables.find((x) => x.id === session?.tableId)?.label ?? "";
          return c ? `${table} · ${checkName(c)}` : table;
        })()}
        onClose={() => setHistoryOf(null)}
      />

      <ModifierDialog
        item={picking}
        onClose={() => setPicking(null)}
        onAdd={(line) => {
          addLine(line);
          setPicking(null);
        }}
      />

      <Dialog
        open={newCheck !== null}
        onOpenChange={(o) => !o && busy === null && setNewCheck(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("check.newCheckTitle", { label: table?.label ?? "" })}</DialogTitle>
            <DialogDescription>{t("check.newCheckBody")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!session) return;
              const label = (newCheck ?? "").trim();
              void run(
                "check",
                async () => {
                  const r = await openDiningCheck({
                    data: {
                      orgId,
                      locationId: storeId,
                      sessionId: session.id,
                      clientKey: newCheckKey.current,
                      ...(label ? { label } : {}),
                    },
                  });
                  setActiveId(r.id);
                },
                t("check.checkOpened"),
                () => setNewCheck(null),
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="dining-check-label">{t("check.checkLabel")}</Label>
              <Input
                id="dining-check-label"
                value={newCheck ?? ""}
                maxLength={40}
                placeholder={t("check.checkLabelPlaceholder")}
                onChange={(e) => setNewCheck(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setNewCheck(null)}
              >
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {t("check.newCheckConfirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moveRound !== null}
        onOpenChange={(o) => !o && busy === null && setMoveRound(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("check.moveRoundTitle")}</DialogTitle>
            <DialogDescription>{t("check.moveRoundBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="dining-move-round-to">{t("check.moveRoundTo")}</Label>
            <Select value={moveRoundTo} onValueChange={setMoveRoundTo}>
              <SelectTrigger id="dining-move-round-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {session?.checks
                  .filter((c) => c.id !== check?.id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {checkName(c)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button variant="outline" disabled={busy !== null} onClick={() => setMoveRound(null)}>
              {t("form.cancel")}
            </Button>
            <Button
              disabled={busy !== null || !moveRoundTo}
              onClick={() =>
                moveRound &&
                void run(
                  "move-round",
                  () =>
                    moveCheckRound({
                      data: {
                        orgId,
                        locationId: storeId,
                        orderId: moveRound,
                        toCheckId: moveRoundTo,
                      },
                    }),
                  t("check.roundMoved"),
                  () => setMoveRound(null),
                )
              }
            >
              {t("check.moveRoundConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={voidTarget !== null}
        onOpenChange={(o) => !o && busy === null && setVoidTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("check.voidTitle")}</DialogTitle>
            <DialogDescription>{t("check.voidBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button variant="outline" disabled={busy !== null} onClick={() => setVoidTarget(null)}>
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() =>
                voidTarget &&
                void run(
                  "void",
                  () =>
                    changeOperationalOrder({
                      data: {
                        id: voidTarget,
                        status: "cancelled",
                        reason: "Round voided at the table",
                      },
                    }),
                  t("check.voided"),
                  () => setVoidTarget(null),
                )
              }
            >
              {t("check.voidConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moving} onOpenChange={(o) => !o && busy === null && setMoving(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("check.moveTitle", { label: table?.label ?? "" })}</DialogTitle>
            <DialogDescription>{t("check.moveBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="dining-move-to">{t("check.moveTo")}</Label>
            <Select value={moveTo} onValueChange={setMoveTo}>
              <SelectTrigger id="dining-move-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {freeTables.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.label} · {t("card.seats", { count: x.seats })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button variant="outline" disabled={busy !== null} onClick={() => setMoving(false)}>
              {t("form.cancel")}
            </Button>
            <Button
              disabled={busy !== null || !moveTo}
              onClick={() =>
                session &&
                void run(
                  "move",
                  () =>
                    moveDiningSession({
                      data: { orgId, locationId: storeId, id: session.id, toTableId: moveTo },
                    }),
                  t("check.moved", {
                    label: room.tables.find((x) => x.id === moveTo)?.label ?? "",
                  }),
                  () => setMoving(false),
                )
              }
            >
              {t("check.moveConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmClose}
        onOpenChange={(o) => !o && busy === null && setConfirmClose(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("check.closeTitle", { label: table?.label ?? "" })}</DialogTitle>
            <DialogDescription>{t("check.closeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => setConfirmClose(false)}
            >
              {t("form.cancel")}
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() =>
                session &&
                void run(
                  "close",
                  () =>
                    closeEmptyDiningSession({
                      data: { orgId, locationId: storeId, id: session.id },
                    }),
                  t("check.closed", { label: table?.label ?? "" }),
                  () => {
                    setConfirmClose(false);
                    onClose();
                  },
                )
              }
            >
              {t("check.closeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={guests !== null} onOpenChange={(o) => !o && busy === null && setGuests(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("check.editGuests")}</DialogTitle>
            <DialogDescription>{t("check.seatHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(guests);
              if (!session) return;
              if (!Number.isInteger(n) || n < 1 || n > 99)
                return setError(t("errors.invalid_guests"));
              void run(
                "guests",
                () =>
                  updateDiningSession({
                    data: {
                      orgId,
                      locationId: storeId,
                      id: session.id,
                      guests: n,
                      serverId: session.serverId,
                    },
                  }),
                t("check.guestsSaved"),
                () => setGuests(null),
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="dining-guests-edit">{t("check.guests")}</Label>
              <Input
                id="dining-guests-edit"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={guests ?? ""}
                onChange={(e) => setGuests(e.target.value)}
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setGuests(null)}
              >
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {t("form.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
