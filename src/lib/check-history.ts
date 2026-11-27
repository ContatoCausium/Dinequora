/**
 * The history of one check, built from the rows the floor already reads (no audit text):
 * when it was opened, each round sent to the kitchen, voided rounds, tenders recorded and reversed,
 * and when it was closed. Rounds moved between checks come from the activity log, which only members
 * with team.activity can read (RLS returns nothing for the others), so a server simply does not see
 * those lines. Reasons (void, reversal) are never shown here: they stay with the people allowed to read
 * them.
 */

export type CheckEventKind =
  | "opened"
  | "round_fired"
  | "round_voided"
  | "round_moved_in"
  | "round_moved_out"
  | "paid"
  | "payment_reversed"
  | "closed"
  | "voided";

export interface CheckEvent {
  kind: CheckEventKind;
  at: string;
  /** Who did it, by name; null when the person is unknown or not visible. */
  actor: string | null;
  roundNo?: number;
  amountCents?: number;
  tipCents?: number;
  method?: string;
  /** The other check of a move, by its number and label. */
  other?: { number: number; label: string | null } | null;
  /** Why a payment was reversed: present only for who may reverse payments (0041). */
  reason?: string;
}

/** Same instant: the opening first, the closing last, the rest in the order things happen. */
const ORDER: Record<CheckEventKind, number> = {
  opened: 0,
  round_moved_in: 1,
  round_fired: 2,
  round_voided: 3,
  round_moved_out: 4,
  paid: 5,
  payment_reversed: 6,
  closed: 7,
  voided: 7,
};

export function toCheckHistory(input: {
  check: {
    id: string;
    status: string;
    opened_at: string;
    opened_by: string | null;
    closed_at: string | null;
  };
  rounds: readonly {
    order_id: string;
    round_no: number;
    fired_at: string;
    fired_by: string | null;
  }[];
  orders: readonly { id: string; total_cents: number }[];
  /** order_status_history rows that cancelled one of the rounds. */
  cancellations: readonly { order_id: string; created_at: string; actor_id: string | null }[];
  tenders: readonly {
    id?: string;
    method: string;
    amount_cents: number;
    tip_cents: number;
    status: string;
    created_at: string;
    created_by: string | null;
    reversed_at: string | null;
    reversed_by: string | null;
  }[];
  /** tables.round_moved activity rows that touch this check (empty without team.activity). */
  moves: readonly {
    created_at: string;
    actor_id: string | null;
    metadata: { from?: string; to?: string } | null;
  }[];
  otherChecks: readonly { id: string; number: number; label: string | null }[];
  profiles: readonly { id: string; full_name: string | null }[];
  /** From list_check_reversal_reasons(); empty for whoever may not read them. */
  reversalReasons?: readonly { payment_id: string; reason: string }[];
}): CheckEvent[] {
  const reasonOf = new Map((input.reversalReasons ?? []).map((r) => [r.payment_id, r.reason]));
  const names = new Map(input.profiles.map((p) => [p.id, p.full_name?.trim() || null]));
  const who = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const totals = new Map(input.orders.map((o) => [o.id, o.total_cents]));
  const roundOf = new Map(input.rounds.map((r) => [r.order_id, r.round_no]));
  const others = new Map(
    input.otherChecks.map((c) => [c.id, { number: c.number, label: c.label?.trim() || null }]),
  );
  const out: CheckEvent[] = [
    { kind: "opened", at: input.check.opened_at, actor: who(input.check.opened_by) },
  ];
  for (const r of input.rounds) {
    out.push({
      kind: "round_fired",
      at: r.fired_at,
      actor: who(r.fired_by),
      roundNo: r.round_no,
      amountCents: totals.get(r.order_id) ?? 0,
    });
  }
  // A round can be cancelled only once; keep the first row per order.
  const seen = new Set<string>();
  for (const c of [...input.cancellations].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )) {
    if (seen.has(c.order_id) || !roundOf.has(c.order_id)) continue;
    seen.add(c.order_id);
    out.push({
      kind: "round_voided",
      at: c.created_at,
      actor: who(c.actor_id),
      roundNo: roundOf.get(c.order_id) ?? 0,
    });
  }
  for (const m of input.moves) {
    const from = m.metadata?.from;
    const to = m.metadata?.to;
    if (to === input.check.id && from) {
      out.push({
        kind: "round_moved_in",
        at: m.created_at,
        actor: who(m.actor_id),
        other: others.get(from) ?? null,
      });
    } else if (from === input.check.id && to) {
      out.push({
        kind: "round_moved_out",
        at: m.created_at,
        actor: who(m.actor_id),
        other: others.get(to) ?? null,
      });
    }
  }
  for (const t of input.tenders) {
    out.push({
      kind: "paid",
      at: t.created_at,
      actor: who(t.created_by),
      method: t.method,
      amountCents: t.amount_cents,
      tipCents: t.tip_cents,
    });
    if (t.status === "reversed" && t.reversed_at) {
      const reason = t.id ? reasonOf.get(t.id)?.trim() : undefined;
      out.push({
        kind: "payment_reversed",
        at: t.reversed_at,
        actor: who(t.reversed_by),
        method: t.method,
        amountCents: t.amount_cents,
        tipCents: t.tip_cents,
        ...(reason ? { reason } : {}),
      });
    }
  }
  if (input.check.closed_at && input.check.status !== "open") {
    out.push({
      kind: input.check.status === "void" ? "voided" : "closed",
      at: input.check.closed_at,
      actor: null,
    });
  }
  return out.sort((a, b) => {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    return ta !== tb ? ta - tb : ORDER[a.kind] - ORDER[b.kind];
  });
}

/** One closed check of the day, for the floor's "closed today" list. */
export interface ClosedCheck {
  id: string;
  tableLabel: string;
  number: number;
  label: string | null;
  closedAt: string;
  /** Recorded tenders applied to the check (tax included, tips excluded). */
  paidCents: number;
  tipsCents: number;
}

export function toClosedChecks(input: {
  checks: readonly {
    id: string;
    session_id: string;
    number: number;
    label: string | null;
    closed_at: string | null;
  }[];
  sessions: readonly { id: string; table_id: string }[];
  tables: readonly { id: string; label: string }[];
  tenders: readonly { check_id: string; amount_cents: number; tip_cents: number; status: string }[];
}): ClosedCheck[] {
  const tableOf = new Map(input.sessions.map((s) => [s.id, s.table_id]));
  const labels = new Map(input.tables.map((t) => [t.id, t.label]));
  const paid = new Map<string, { paid: number; tips: number }>();
  for (const t of input.tenders) {
    if (t.status !== "recorded") continue;
    const cur = paid.get(t.check_id) ?? { paid: 0, tips: 0 };
    cur.paid += t.amount_cents;
    cur.tips += t.tip_cents;
    paid.set(t.check_id, cur);
  }
  return input.checks
    .filter((c) => c.closed_at)
    .map((c) => ({
      id: c.id,
      tableLabel: labels.get(tableOf.get(c.session_id) ?? "") ?? "",
      number: c.number,
      label: c.label?.trim() || null,
      closedAt: c.closed_at as string,
      paidCents: paid.get(c.id)?.paid ?? 0,
      tipsCents: paid.get(c.id)?.tips ?? 0,
    }))
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt));
}
