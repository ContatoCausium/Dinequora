/**
 * Dining room, step 1 (migration 0037): sections, tables and table status of one store.
 * Pure module (no I/O): read model, grouping and the error codes of the RPCs, shared by the server
 * functions and the Tables screen. The DATABASE decides who may do what (RLS + RPC asserts, behind
 * the table_service feature); this module only shapes what the screen shows.
 */

export const TABLE_STATUSES = ["available", "occupied", "reserved", "cleaning"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];
export const isTableStatus = (v: unknown): v is TableStatus =>
  typeof v === "string" && (TABLE_STATUSES as readonly string[]).includes(v);

export interface DiningSection {
  id: string;
  name: string;
  sortOrder: number;
}

export interface DiningTable {
  id: string;
  label: string;
  seats: number;
  status: TableStatus;
  sectionId: string | null;
  sortOrder: number;
  statusChangedAt: string;
}

export interface DiningRoom {
  storeId: string;
  sections: DiningSection[];
  tables: DiningTable[];
  /** Open sessions of the store (step 2, migration 0038), one per occupied-by-a-party table. */
  sessions: OpenSession[];
  /** The store's sales-tax rate (ppm) the screen shows and confirms when sending a round; null = none. */
  taxRatePpm: number | null;
}

export interface RoundItem {
  name: string;
  quantity: number;
  subtotalCents: number;
  modifiers: string[];
  notes: string | null;
}
export interface CheckRound {
  orderId: string;
  roundNo: number;
  firedAt: string;
  /** The kitchen status of the round's order (new, in_prep, ready, delivered, cancelled…). */
  status: string;
  totalCents: number;
  items: RoundItem[];
}
export interface SessionCheck {
  id: string;
  number: number;
  label: string | null;
  rounds: CheckRound[];
  /** Sum of the rounds that are not cancelled (tax included): what this check will charge. */
  liveTotalCents: number;
  liveRounds: number;
}
export interface OpenSession {
  id: string;
  tableId: string;
  guests: number;
  serverId: string;
  serverName: string | null;
  openedAt: string;
  /** Open checks of the table, by number (check 1 is created with the session). */
  checks: SessionCheck[];
  /** Totals of every open check of the table. */
  liveTotalCents: number;
  liveRounds: number;
}

export type SessionRows = {
  sessions: readonly {
    id: string;
    table_id: string;
    guests: number;
    server_id: string;
    opened_at: string;
  }[];
  checks: readonly {
    id: string;
    session_id: string;
    status: string;
    number: number;
    label: string | null;
  }[];
  rounds: readonly { check_id: string; order_id: string; round_no: number; fired_at: string }[];
  orders: readonly { id: string; status: string; total_cents: number }[];
  items: readonly {
    order_id: string;
    product_name: string;
    quantity: number;
    subtotal_cents: number;
    notes: string | null;
    order_item_modifiers?: readonly { option_name: string }[] | null;
  }[];
  profiles: readonly { id: string; full_name: string | null }[];
};

/** Open sessions with their open checks (by number) and each check's rounds (oldest first). */
export function toOpenSessions(rows: SessionRows): OpenSession[] {
  const orders = new Map(rows.orders.map((o) => [o.id, o]));
  const names = new Map(rows.profiles.map((p) => [p.id, p.full_name]));
  const roundsOf = (checkId: string): CheckRound[] =>
    rows.rounds
      .filter((r) => r.check_id === checkId && orders.has(r.order_id))
      .sort((a, b) => a.round_no - b.round_no)
      .map((r) => {
        const o = orders.get(r.order_id)!;
        return {
          orderId: r.order_id,
          roundNo: r.round_no,
          firedAt: r.fired_at,
          status: o.status,
          totalCents: o.total_cents,
          items: rows.items
            .filter((i) => i.order_id === r.order_id)
            .map((i) => ({
              name: i.product_name,
              quantity: i.quantity,
              subtotalCents: i.subtotal_cents,
              modifiers: (i.order_item_modifiers ?? []).map((m) => m.option_name),
              notes: i.notes,
            })),
        };
      });
  return rows.sessions.map((s) => {
    const checks: SessionCheck[] = rows.checks
      .filter((c) => c.session_id === s.id && c.status === "open")
      .sort((a, b) => a.number - b.number)
      .map((c) => {
        const rounds = roundsOf(c.id);
        const live = rounds.filter((r) => r.status !== "cancelled");
        return {
          id: c.id,
          number: c.number,
          label: c.label,
          rounds,
          liveTotalCents: live.reduce((n, r) => n + r.totalCents, 0),
          liveRounds: live.length,
        };
      });
    return {
      id: s.id,
      tableId: s.table_id,
      guests: s.guests,
      serverId: s.server_id,
      serverName: names.get(s.server_id)?.trim() || null,
      openedAt: s.opened_at,
      checks,
      liveTotalCents: checks.reduce((n, c) => n + c.liveTotalCents, 0),
      liveRounds: checks.reduce((n, c) => n + c.liveRounds, 0),
    };
  });
}

/** A line of the round being prepared (not sent yet). Same shape the POS sends. */
export interface DraftLine {
  key: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  modifiers: { groupId: string; optionId: string; name: string; priceCents: number }[];
  notes: string;
}
export const draftLineCents = (l: DraftLine) =>
  (l.unitPriceCents + l.modifiers.reduce((n, m) => n + m.priceCents, 0)) * l.quantity;
export const draftCents = (lines: readonly DraftLine[]) =>
  lines.reduce((n, l) => n + draftLineCents(l), 0);
/** The tax the server will add to a round at the store rate (same rounding as create_pos_sale_v2). */
export const roundTaxCents = (subtotalCents: number, ratePpm: number) =>
  Math.round((subtotalCents * ratePpm) / 1_000_000);

type SectionRow = { id: string; name: string; sort_order: number; archived_at: string | null };
type TableRow = {
  id: string;
  label: string;
  seats: number;
  status: string;
  section_id: string | null;
  sort_order: number;
  status_changed_at: string;
  archived_at: string | null;
};

/** Natural order for labels people number by hand: "T2" before "T10". */
const byLabel = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

/** Active rows only, in the order the floor shows them (sort order, then name / label). */
export function toDiningRoom(
  storeId: string,
  sections: readonly SectionRow[],
  tables: readonly TableRow[],
  extra: { sessions?: OpenSession[]; taxRatePpm?: number | null } = {},
): DiningRoom {
  const active = sections
    .filter((s) => s.archived_at === null)
    .map((s) => ({ id: s.id, name: s.name, sortOrder: s.sort_order }))
    .sort((a, b) => a.sortOrder - b.sortOrder || byLabel.compare(a.name, b.name));
  const ids = new Set(active.map((s) => s.id));
  return {
    storeId,
    sessions: extra.sessions ?? [],
    taxRatePpm: extra.taxRatePpm ?? null,
    sections: active,
    tables: tables
      .filter((t) => t.archived_at === null)
      .map((t) => ({
        id: t.id,
        label: t.label,
        seats: t.seats,
        // An unknown value is never shown as a real status (the database only stores these four).
        status: isTableStatus(t.status) ? t.status : "available",
        // A table whose section is not active is shown without a section.
        sectionId: t.section_id && ids.has(t.section_id) ? t.section_id : null,
        sortOrder: t.sort_order,
        statusChangedAt: t.status_changed_at,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || byLabel.compare(a.label, b.label)),
  };
}

export interface FloorGroup {
  /** null = tables without a section. */
  section: DiningSection | null;
  tables: DiningTable[];
}

/** Sections in order, each with its tables; tables without a section last. Empty sections stay. */
export function groupFloor(room: DiningRoom, status: TableStatus | "all" = "all"): FloorGroup[] {
  const visible = room.tables.filter((t) => status === "all" || t.status === status);
  const groups: FloorGroup[] = room.sections.map((section) => ({
    section,
    tables: visible.filter((t) => t.sectionId === section.id),
  }));
  const loose = visible.filter((t) => t.sectionId === null);
  if (loose.length || room.sections.length === 0) groups.push({ section: null, tables: loose });
  return groups;
}

export function countByStatus(room: DiningRoom): Record<TableStatus, number> {
  const out: Record<TableStatus, number> = { available: 0, occupied: 0, reserved: 0, cleaning: 0 };
  for (const t of room.tables) out[t.status] += 1;
  return out;
}

export function seatsByStatus(room: DiningRoom, status: TableStatus): number {
  return room.tables.filter((t) => t.status === status).reduce((n, t) => n + t.seats, 0);
}

/** Error codes raised by the 0037 RPCs (and the shared scope checks) that the screen explains. */
export const DINING_ERRORS = [
  "permission_denied",
  "forbidden",
  "location_forbidden",
  "subscription_inactive",
  "invalid_name",
  "invalid_label",
  "invalid_seats",
  "invalid_sort_order",
  "invalid_status",
  "section_not_found",
  "section_name_taken",
  "section_not_empty",
  "table_not_found",
  "table_label_taken",
  "table_occupied",
  "status_conflict",
  "table_has_open_check",
  "table_not_available",
  "invalid_guests",
  "invalid_server",
  "invalid_key",
  "session_not_found",
  "check_not_found",
  "check_not_open",
  "check_has_items",
  "idempotency_conflict",
  "order_cancelled",
  "tax_rate_not_configured",
  "tax_rate_changed",
  "product_not_in_store",
  "invalid_quantity",
  "modifier_selection_invalid",
  "insufficient_stock",
  "order_empty",
  "too_many_checks",
] as const;
export type DiningError = (typeof DINING_ERRORS)[number];

/** The message key for an error thrown by a dining-room server function ("unknown" otherwise). */
export function diningErrorKey(e: unknown): DiningError | "unknown" {
  const message = e instanceof Error ? e.message : String(e ?? "");
  const found = DINING_ERRORS.find((c) => message === c || message.startsWith(`${c}:`));
  return found ?? "unknown";
}
