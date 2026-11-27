import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Banknote, CreditCard, Smartphone, Undo2 } from "lucide-react";

import { Segmented } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { fmtMoneyCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  diningErrorKey,
  equalShares,
  itemsShareCents,
  parseMoneyInput,
  tipCents as tipOf,
  type SessionCheck,
  type TenderMethod,
} from "@/lib/dining-room";
import { payDiningCheck, voidCheckPayment } from "@/lib/operational.functions";

const METHOD_ICON = { cash: Banknote, card: CreditCard, digital: Smartphone } as const;
const TIP_PERCENTS = [0, 15, 18, 20] as const;
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const centsToInput = (c: number) => (c / 100).toFixed(2);

/**
 * Paying one check: what is left, the tenders already recorded (a manager can reverse one while the
 * check is open), and a new tender. Split by person = the balance divided into equal shares; split by
 * items = the selected items with their share of the round's tax. Each is one tender; the check closes
 * when the tenders cover it, and the table when its last check closes.
 */
export function CheckPayment({
  check,
  orgId,
  storeId,
  can,
  reload,
  onSettled,
}: {
  check: SessionCheck;
  orgId: string;
  storeId: string;
  can: { sell: boolean; serve: boolean; refund: boolean };
  reload: () => Promise<unknown>;
  /** The check closed with this tender. */
  onSettled: () => void;
}) {
  const { t, i18n } = useTranslation("tables");
  const money = (c: number) => fmtMoneyCents(c, i18n.language);
  const [method, setMethod] = useState<TenderMethod>("card");
  const [amount, setAmount] = useState(() => centsToInput(check.balanceCents));
  const [tipPercent, setTipPercent] = useState<number | "custom">(0);
  const [tipCustom, setTipCustom] = useState("");
  const [tendered, setTendered] = useState("");
  const [people, setPeople] = useState("2");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [mode, setMode] = useState<"full" | "people" | "items">("full");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reverse, setReverse] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const key = useRef<string | null>(null);

  // A new balance (another tender, a new round) resets the form to "pay what is left".
  useEffect(() => {
    setAmount(centsToInput(check.balanceCents));
    setMode("full");
    setPicked(new Set());
    key.current = null;
  }, [check.id, check.balanceCents]);

  const liveItems = useMemo(
    () =>
      check.rounds
        .filter((r) => r.status !== "cancelled")
        .flatMap((r) => {
          const roundSubtotal = r.items.reduce((n, i) => n + i.subtotalCents, 0);
          return r.items.map((i, n) => ({
            key: `${r.orderId}:${n}`,
            label: `${i.quantity} × ${i.name}`,
            subtotalCents: i.subtotalCents,
            roundSubtotalCents: roundSubtotal,
            roundTaxCents: r.totalCents - roundSubtotal,
          }));
        }),
    [check.rounds],
  );
  const shares = equalShares(check.balanceCents, Number(people) || 1);
  const itemsCents = Math.min(
    check.balanceCents,
    itemsShareCents(liveItems.filter((i) => picked.has(i.key))),
  );
  useEffect(() => {
    key.current = null;
    if (mode === "people") setAmount(centsToInput(shares[0] ?? 0));
    if (mode === "items") setAmount(centsToInput(itemsCents));
    if (mode === "full") setAmount(centsToInput(check.balanceCents));
    // shares/itemsCents derive from people/picked/balance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, people, itemsCents]);

  const amountCents = parseMoneyInput(amount);
  const tip =
    tipPercent === "custom"
      ? (parseMoneyInput(tipCustom) ?? 0)
      : amountCents
        ? tipOf(amountCents, tipPercent)
        : 0;
  const tenderedCents = method === "cash" && tendered.trim() ? parseMoneyInput(tendered) : null;
  const change =
    tenderedCents !== null && amountCents !== null ? tenderedCents - amountCents - tip : null;

  async function submit() {
    setError(null);
    if (amountCents === null || amountCents <= 0) return setError(t("errors.invalid_amount"));
    if (amountCents > check.balanceCents) return setError(t("errors.payment_exceeds_balance"));
    if (tipPercent === "custom" && parseMoneyInput(tipCustom) === null && tipCustom.trim())
      return setError(t("errors.invalid_tip"));
    if (method === "cash" && tendered.trim() && (tenderedCents === null || (change ?? -1) < 0))
      return setError(t("errors.invalid_tendered"));
    key.current ??= newKey();
    setBusy(true);
    try {
      const r = await payDiningCheck({
        data: {
          orgId,
          locationId: storeId,
          checkId: check.id,
          clientKey: key.current,
          method,
          amountCents,
          tipCents: tip,
          tenderedCents,
        },
      });
      key.current = null;
      setTendered("");
      setTipPercent(0);
      setTipCustom("");
      if (r.checkStatus === "closed") {
        toast.success(t("pay.closed"));
        onSettled();
      } else toast.success(t("pay.recorded", { balance: money(r.balanceCents) }));
    } catch (e) {
      // Nothing was written on a refusal; the key is kept so a retry after a lost reply is not a second tender.
      setError(t(`errors.${diningErrorKey(e)}`));
    } finally {
      await reload();
      setBusy(false);
    }
  }

  async function confirmReverse() {
    if (!reverse) return;
    setBusy(true);
    setError(null);
    try {
      await voidCheckPayment({ data: { orgId, locationId: storeId, id: reverse, reason } });
      toast.success(t("pay.reversed"));
      setReverse(null);
      setReason("");
    } catch (e) {
      setError(t(`errors.${diningErrorKey(e)}`));
    } finally {
      await reload();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`pay-${check.id}`} className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 id={`pay-${check.id}`} className="text-sm font-semibold">
          {t("pay.title")}
        </h3>
        <p className="text-sm">
          <span className="text-muted-foreground">{t("pay.balance")} </span>
          <span className="font-semibold tabular-nums">{money(check.balanceCents)}</span>
        </p>
      </div>

      {check.tenders.length > 0 && (
        <ul className="space-y-1 text-[13px]">
          {check.tenders.map((p) => {
            const Icon = METHOD_ICON[p.method];
            return (
              <li
                key={p.id}
                className={cn(
                  "flex items-center gap-2",
                  p.reversed && "text-muted-foreground line-through",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">
                  {t(`pay.methods.${p.method}`)}
                  {p.tipCents > 0 && ` · ${t("pay.tipOf", { tip: money(p.tipCents) })}`}
                  {p.changeCents > 0 && ` · ${t("pay.changeOf", { change: money(p.changeCents) })}`}
                  {p.reversed && <span className="sr-only"> ({t("pay.reversedLabel")})</span>}
                </span>
                <span className="tabular-nums">{money(p.amountCents)}</span>
                {can.refund && !p.reversed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("pay.reverse", { amount: money(p.amountCents) })}
                    onClick={() => setReverse(p.id)}
                  >
                    <Undo2 aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {check.balanceCents > 0 && can.serve && (
        <div className="space-y-3 rounded-lg border p-3">
          <Segmented
            label={t("pay.splitLabel")}
            value={mode}
            onChange={setMode}
            fill
            options={[
              { value: "full", label: t("pay.split.full") },
              { value: "people", label: t("pay.split.people") },
              { value: "items", label: t("pay.split.items") },
            ]}
          />
          {mode === "people" && (
            <div className="flex items-end gap-3">
              <div className="w-24 space-y-1.5">
                <Label htmlFor={`pay-people-${check.id}`}>{t("pay.people")}</Label>
                <Input
                  id={`pay-people-${check.id}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  value={people}
                  onChange={(e) => setPeople(e.target.value)}
                />
              </div>
              <p className="pb-2 text-[13px] text-muted-foreground">
                {t("pay.perPerson", { amount: money(shares[0] ?? 0) })}
              </p>
            </div>
          )}
          {mode === "items" && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-[13px] text-muted-foreground">
                {t("pay.pickItems")}
              </legend>
              {liveItems.map((i) => (
                <label key={i.key} className="flex items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={picked.has(i.key)}
                    onCheckedChange={(on) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (on === true) n.add(i.key);
                        else n.delete(i.key);
                        return n;
                      })
                    }
                  />
                  <span className="flex-1">{i.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {money(i.subtotalCents)}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <div role="radiogroup" aria-label={t("pay.method")} className="grid grid-cols-3 gap-2">
            {(["card", "cash", "digital"] as const).map((m) => {
              const Icon = METHOD_ICON[m];
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => {
                    key.current = null;
                    setMethod(m);
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    method === m ? "border-primary bg-primary-soft font-medium" : "bg-card",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t(`pay.methods.${m}`)}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`pay-amount-${check.id}`}>{t("pay.amount")}</Label>
              <Input
                id={`pay-amount-${check.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  key.current = null;
                  setAmount(e.target.value);
                }}
              />
            </div>
            {method === "cash" && (
              <div className="space-y-1.5">
                <Label htmlFor={`pay-tendered-${check.id}`}>{t("pay.tendered")}</Label>
                <Input
                  id={`pay-tendered-${check.id}`}
                  inputMode="decimal"
                  value={tendered}
                  placeholder={t("pay.optional")}
                  onChange={(e) => {
                    key.current = null;
                    setTendered(e.target.value);
                  }}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-[13px] font-medium" id={`pay-tip-${check.id}`}>
              {t("pay.tip")}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={`pay-tip-${check.id}`}
              className="flex flex-wrap gap-2"
            >
              {TIP_PERCENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={tipPercent === p}
                  onClick={() => {
                    key.current = null;
                    setTipPercent(p);
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tipPercent === p ? "border-primary bg-primary-soft font-medium" : "bg-card",
                  )}
                >
                  {p === 0 ? t("pay.noTip") : `${p}%`}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={tipPercent === "custom"}
                onClick={() => {
                  key.current = null;
                  setTipPercent("custom");
                }}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tipPercent === "custom"
                    ? "border-primary bg-primary-soft font-medium"
                    : "bg-card",
                )}
              >
                {t("pay.customTip")}
              </button>
            </div>
            {tipPercent === "custom" && (
              <Input
                aria-label={t("pay.customTipAmount")}
                inputMode="decimal"
                value={tipCustom}
                onChange={(e) => {
                  key.current = null;
                  setTipCustom(e.target.value);
                }}
              />
            )}
          </div>

          <div className="space-y-0.5 text-[13px]">
            <p className="flex justify-between">
              <span>{t("pay.charge")}</span>
              <span className="tabular-nums font-semibold">{money((amountCents ?? 0) + tip)}</span>
            </p>
            {tip > 0 && (
              <p className="flex justify-between text-muted-foreground">
                <span>{t("pay.tipLine")}</span>
                <span className="tabular-nums">{money(tip)}</span>
              </p>
            )}
            {change !== null && change >= 0 && (
              <p className="flex justify-between text-muted-foreground">
                <span>{t("pay.change")}</span>
                <span className="tabular-nums">{money(change)}</span>
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button className="w-full" disabled={busy || !can.sell} onClick={() => void submit()}>
            {busy
              ? t("pay.recording")
              : amountCents !== null && amountCents === check.balanceCents
                ? t("pay.payAndClose", { amount: money(amountCents + tip) })
                : t("pay.payPart", { amount: money((amountCents ?? 0) + tip) })}
          </Button>
          {!can.sell && <p className="text-[12px] text-muted-foreground">{t("pay.needSell")}</p>}
          <p className="text-[12px] text-muted-foreground">{t("pay.recordOnly")}</p>
        </div>
      )}

      <Dialog open={reverse !== null} onOpenChange={(o) => !o && !busy && setReverse(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("pay.reverseTitle")}</DialogTitle>
            <DialogDescription>{t("pay.reverseBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pay-reverse-reason">{t("pay.reason")}</Label>
            <Input
              id="pay-reverse-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => setReverse(null)}>
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void confirmReverse()}
            >
              {t("pay.reverseConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
