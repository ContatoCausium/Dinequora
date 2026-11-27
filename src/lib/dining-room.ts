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
}

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
): DiningRoom {
  const active = sections
    .filter((s) => s.archived_at === null)
    .map((s) => ({ id: s.id, name: s.name, sortOrder: s.sort_order }))
    .sort((a, b) => a.sortOrder - b.sortOrder || byLabel.compare(a.name, b.name));
  const ids = new Set(active.map((s) => s.id));
  return {
    storeId,
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
] as const;
export type DiningError = (typeof DINING_ERRORS)[number];

/** The message key for an error thrown by a dining-room server function ("unknown" otherwise). */
export function diningErrorKey(e: unknown): DiningError | "unknown" {
  const message = e instanceof Error ? e.message : String(e ?? "");
  const found = DINING_ERRORS.find((c) => message === c || message.startsWith(`${c}:`));
  return found ?? "unknown";
}
