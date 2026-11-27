// CLIENT PREVIEW: today's dining room (0037-0039), seeded after the business history.
//
// The floor of each store and today's service, through the same RPCs as the Tables screen, signed in
// as the demo owner (Westside's tables are served by the store manager, so the tips report shows more
// than one server): sections and tables, checks closed today (one table split into two named checks,
// card with a tip, cash with change, an equal split paid by several people), their rounds delivered by
// the kitchen, tables still eating with rounds in the kitchen, and reserved tables. Everything happens
// "now", so the Today panel, the day close, the tips report and the check histories show today.
//
// The Tables module (feature table_service) is turned on for the demo organization only, with the
// service key through the dataset function client_preview_enable_feature, as a platform admin
// would from the Control Center. Products are referred to by their
// dataset ids (the sale RPCs accept a product's client id).
import crypto from "node:crypto";
import { ACCOUNTS, STORES } from "./dataset.mjs";
import { assertResolvedTarget } from "./client-preview-target.mjs";

export const FLOOR = Object.freeze({
  downtown: {
    sections: [
      { name: "Main room", tables: ["T1", "T2", "T3", "T4", "T5"], seats: 4 },
      { name: "Patio", tables: ["P1", "P2", "P3"], seats: 2 },
    ],
    closed: [
      {
        table: "T1",
        guests: 2,
        checks: [{ items: ["prod-classic-burger", "prod-cheeseburger"], pay: [["card", 18]] }],
      },
      {
        table: "T2",
        guests: 4,
        checks: [
          { items: ["prod-cheeseburger"], pay: [["card", 20]] },
          {
            label: "Ben",
            items: ["prod-classic-burger", "prod-classic-burger"],
            pay: [["cash", 15]],
          },
        ],
      },
      {
        table: "P1",
        guests: 2,
        checks: [
          {
            items: ["prod-classic-burger", "prod-cheeseburger"],
            pay: [
              ["card", 18],
              ["cash", 0],
            ],
          },
        ],
      },
    ],
    open: [
      {
        table: "T3",
        guests: 3,
        checks: [{ items: ["prod-cheeseburger", "prod-classic-burger"], kitchen: "in_prep" }],
      },
      {
        table: "T4",
        guests: 2,
        checks: [
          { items: ["prod-classic-burger"], kitchen: "ready" },
          { label: "Dana", items: ["prod-cheeseburger"], kitchen: "new" },
        ],
      },
    ],
    reserved: ["T5"],
  },
  westside: {
    server: "manager",
    sections: [
      { name: "Main room", tables: ["W1", "W2", "W3", "W4"], seats: 4 },
      { name: "Patio", tables: ["W5", "W6"], seats: 2 },
    ],
    closed: [
      {
        table: "W1",
        guests: 2,
        checks: [{ items: ["prod-cheeseburger", "prod-classic-burger"], pay: [["card", 18]] }],
      },
      {
        table: "W5",
        guests: 3,
        checks: [
          {
            items: ["prod-classic-burger", "prod-cheeseburger", "prod-classic-burger"],
            pay: [
              ["digital", 20],
              ["card", 20],
              ["cash", 0],
            ],
          },
        ],
      },
    ],
    open: [
      { table: "W2", guests: 2, checks: [{ items: ["prod-classic-burger"], kitchen: "in_prep" }] },
    ],
    reserved: [],
  },
  airport: {
    sections: [{ name: "Food court", tables: ["A1", "A2", "A3", "A4", "A5"], seats: 2 }],
    closed: [
      { table: "A1", guests: 1, checks: [{ items: ["prod-cheeseburger"], pay: [["card", 15]] }] },
    ],
    open: [
      {
        table: "A2",
        guests: 2,
        checks: [{ items: ["prod-classic-burger", "prod-cheeseburger"], kitchen: "new" }],
      },
    ],
    reserved: ["A5"],
  },
});

const KITCHEN_STEPS = Object.freeze({
  new: [],
  in_prep: ["in_prep"],
  ready: ["in_prep", "ready"],
  delivered: ["in_prep", "ready", "delivered"],
});

/** Splits `total` into `n` shares (the first ones carry the odd cents), like the payment panel. */
export function shares(total, n) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

/** What the floor plan promises, for the verifier. */
export function floorExpectations() {
  let tables = 0;
  let closed = 0;
  let open = 0;
  let payments = 0;
  for (const f of Object.values(FLOOR)) {
    for (const s of f.sections) tables += s.tables.length;
    for (const p of f.closed)
      for (const c of p.checks) {
        closed += 1;
        payments += c.pay.length;
      }
    for (const p of f.open) open += p.checks.length;
  }
  return { tables, closed, open, payments };
}

/**
 * @param {{ target: any, owner: any, svc: any, orgId: string, loc: Record<string, string>,
 *   rpc: (client: any, fn: string, args: object, opts?: object) => Promise<any>,
 *   must: (promise: any, what: string) => Promise<any>, log: (s: string) => void }} ctx
 */
export async function seedDiningRoom({ target, owner, svc, orgId, loc, rpc, must, log }) {
  // Only a destination checked by resolvePreviewTarget (the same guard seed-core runs first).
  assertResolvedTarget(target);
  const key = () => `cp-dine-${crypto.randomUUID()}`;
  // The API role has no write on org_features (only admin_set_org_feature, for platform admins, and
  // the demo has none): the dataset function does it, after the same destination check.
  await rpc(svc, "client_preview_enable_feature", { _org_id: orgId, _feature: "table_service" });

  // Westside's server: the demo store manager (a member with access to that store).
  const manager = ACCOUNTS.find((a) => a.key === "manager");
  let managerId = null;
  if (manager) {
    const people = await must(
      svc.from("organization_members").select("user_id,role").eq("org_id", orgId),
      "members",
    );
    const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const u = (data?.users ?? []).find(
      (x) => (x.email ?? "").toLowerCase() === manager.email.toLowerCase(),
    );
    if (u && people.some((m) => m.user_id === u.id)) managerId = u.id;
  }

  const counts = { tables: 0, closedChecks: 0, openChecks: 0, payments: 0 };
  for (const store of STORES) {
    const floor = FLOOR[store.key];
    const L = loc[store.key];
    if (!floor || !L) continue;
    const tableId = {};
    let sort = 0;
    for (const [i, s] of floor.sections.entries()) {
      const sectionId = await rpc(owner, "save_dining_section", {
        _org_id: orgId,
        _location_id: L,
        _name: s.name,
        _sort_order: i,
      });
      for (const label of s.tables) {
        tableId[label] = await rpc(owner, "save_dining_table", {
          _org_id: orgId,
          _location_id: L,
          _label: label,
          _seats: s.seats,
          _sort_order: sort++,
          _section_id: sectionId,
        });
        counts.tables += 1;
      }
    }
    const server = floor.server === "manager" && managerId ? { _server_id: managerId } : {};

    /** Seats the party, opens its checks and sends one round per check. */
    const serve = async (party) => {
      const sessionId = await rpc(owner, "open_dining_session", {
        _org_id: orgId,
        _location_id: L,
        _table_id: tableId[party.table],
        _guests: party.guests,
        _client_key: key(),
        ...server,
      });
      const first = await must(
        svc.from("dining_checks").select("id").eq("session_id", sessionId).order("number").limit(1),
        "dining_checks",
      );
      const out = [];
      for (const [i, c] of party.checks.entries()) {
        const checkId =
          i === 0
            ? first[0]?.id
            : await rpc(owner, "open_dining_check", {
                _org_id: orgId,
                _location_id: L,
                _session_id: sessionId,
                _client_key: key(),
                ...(c.label ? { _label: c.label } : {}),
              });
        if (!checkId) throw new Error("dining_checks: the session opened no check");
        const orderId = await rpc(owner, "fire_check_round", {
          _org_id: orgId,
          _location_id: L,
          _check_id: checkId,
          _client_key: key(),
          _tax_rate_ppm: store.taxRatePpm,
          _items: c.items.map((p) => ({ product_id: p, quantity: 1, notes: null, modifiers: [] })),
        });
        out.push({ check: c, checkId, orderId });
      }
      return out;
    };
    const advance = async (orderId, to) => {
      for (const st of KITCHEN_STEPS[to] ?? [])
        await rpc(
          owner,
          "update_order_status",
          { _order_id: orderId, _new_status: st, _reason: "Kitchen (demo)" },
          { idempotent: true },
        );
    };

    for (const party of floor.closed) {
      for (const { check, checkId, orderId } of await serve(party)) {
        await advance(orderId, "delivered");
        const [order] = await must(
          svc.from("orders").select("subtotal_cents,total_cents").eq("id", orderId),
          "orders",
        );
        const parts = shares(order.total_cents, check.pay.length);
        for (const [i, [method, tipPct]] of check.pay.entries()) {
          const tip = Math.round((order.subtotal_cents / check.pay.length) * (tipPct / 100));
          const amount = parts[i];
          const tendered = method === "cash" ? Math.ceil((amount + tip) / 500) * 500 : null;
          await rpc(owner, "pay_dining_check", {
            _org_id: orgId,
            _location_id: L,
            _check_id: checkId,
            _client_key: key(),
            _method: method,
            _amount_cents: amount,
            _tip_cents: tip,
            ...(tendered ? { _tendered_cents: tendered } : {}),
          });
          counts.payments += 1;
        }
        counts.closedChecks += 1;
      }
    }
    // A closed table goes to Cleaning; the first one of each store is cleaned already.
    const firstClosed = floor.closed[0];
    if (firstClosed)
      await rpc(owner, "set_dining_table_status", {
        _org_id: orgId,
        _location_id: L,
        _table_id: tableId[firstClosed.table],
        _status: "available",
        _expected_status: "cleaning",
      });
    for (const party of floor.open)
      for (const { check, orderId } of await serve(party)) {
        await advance(orderId, check.kitchen ?? "new");
        counts.openChecks += 1;
      }
    for (const label of floor.reserved)
      await rpc(owner, "set_dining_table_status", {
        _org_id: orgId,
        _location_id: L,
        _table_id: tableId[label],
        _status: "reserved",
        _expected_status: "available",
      });
  }
  log(
    `dining room: ${counts.tables} tables, ${counts.closedChecks} checks closed today (${counts.payments} payments), ${counts.openChecks} checks open`,
  );
  return counts;
}
