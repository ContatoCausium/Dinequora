import { describe, expect, it } from "vitest";
import { toCheckHistory, toClosedChecks } from "@/lib/check-history";

const base = {
  check: {
    id: "c1",
    status: "closed",
    opened_at: "2026-11-27T12:00:00Z",
    opened_by: "u-sam",
    closed_at: "2026-11-27T13:00:00Z",
  },
  rounds: [
    { order_id: "o1", round_no: 1, fired_at: "2026-11-27T12:05:00Z", fired_by: "u-sam" },
    { order_id: "o2", round_no: 2, fired_at: "2026-11-27T12:20:00Z", fired_by: "u-sam" },
  ],
  orders: [
    { id: "o1", total_cents: 1700 },
    { id: "o2", total_cents: 428 },
  ],
  cancellations: [
    { order_id: "o2", created_at: "2026-11-27T12:25:00Z", actor_id: "u-mia" },
    // a second row for the same order (never expected) is ignored
    { order_id: "o2", created_at: "2026-11-27T12:26:00Z", actor_id: "u-mia" },
    // a cancellation of an order that is not a round of this check is ignored
    { order_id: "elsewhere", created_at: "2026-11-27T12:27:00Z", actor_id: "u-mia" },
  ],
  tenders: [
    {
      method: "card",
      amount_cents: 1000,
      tip_cents: 0,
      status: "reversed",
      created_at: "2026-11-27T12:50:00Z",
      created_by: "u-sam",
      reversed_at: "2026-11-27T12:52:00Z",
      reversed_by: "u-mia",
    },
    {
      method: "cash",
      amount_cents: 1700,
      tip_cents: 300,
      status: "recorded",
      created_at: "2026-11-27T13:00:00Z",
      created_by: "u-sam",
      reversed_at: null,
      reversed_by: null,
    },
  ],
  moves: [],
  otherChecks: [],
  profiles: [
    { id: "u-sam", full_name: "Sam " },
    { id: "u-mia", full_name: "Mia" },
  ],
};

describe("check history", () => {
  it("orders every event in time, with who did it; the closing comes after the last payment", () => {
    const h = toCheckHistory(base);
    expect(h.map((e) => e.kind)).toEqual([
      "opened",
      "round_fired",
      "round_fired",
      "round_voided",
      "paid",
      "payment_reversed",
      "paid",
      "closed",
    ]);
    expect(h[0]).toMatchObject({ actor: "Sam" });
    expect(h[1]).toMatchObject({ roundNo: 1, amountCents: 1700 });
    expect(h[3]).toMatchObject({ roundNo: 2, actor: "Mia", at: "2026-11-27T12:25:00Z" });
    expect(h[5]).toMatchObject({ amountCents: 1000, actor: "Mia", method: "card" });
    expect(h[6]).toMatchObject({ amountCents: 1700, tipCents: 300, method: "cash" });
    expect(h[7]).toMatchObject({ kind: "closed", actor: null });
  });

  it("an open check has no closing line; an emptied check reads as voided", () => {
    expect(
      toCheckHistory({ ...base, check: { ...base.check, status: "open", closed_at: null } }).some(
        (e) => e.kind === "closed" || e.kind === "voided",
      ),
    ).toBe(false);
    const v = toCheckHistory({
      ...base,
      rounds: [],
      tenders: [],
      cancellations: [],
      check: { ...base.check, status: "void" },
    });
    expect(v.map((e) => e.kind)).toEqual(["opened", "voided"]);
  });

  it("moves name the other check; an unknown person or check stays blank", () => {
    const h = toCheckHistory({
      ...base,
      tenders: [],
      cancellations: [],
      moves: [
        {
          created_at: "2026-11-27T12:10:00Z",
          actor_id: "u-mia",
          metadata: { from: "c2", to: "c1" },
        },
        {
          created_at: "2026-11-27T12:30:00Z",
          actor_id: "u-gone",
          metadata: { from: "c1", to: "c9" },
        },
        // a move between two other checks never shows here
        { created_at: "2026-11-27T12:31:00Z", actor_id: null, metadata: { from: "c2", to: "c3" } },
      ],
      otherChecks: [{ id: "c2", number: 2, label: "Ana" }],
    });
    const moves = h.filter((e) => e.kind.startsWith("round_moved"));
    expect(moves).toEqual([
      {
        kind: "round_moved_in",
        at: "2026-11-27T12:10:00Z",
        actor: "Mia",
        other: { number: 2, label: "Ana" },
      },
      { kind: "round_moved_out", at: "2026-11-27T12:30:00Z", actor: null, other: null },
    ]);
  });
});

describe("checks closed today", () => {
  it("newest first, with the table and what was paid (reversed tenders left out)", () => {
    const list = toClosedChecks({
      checks: [
        { id: "a", session_id: "s1", number: 1, label: null, closed_at: "2026-11-27T12:00:00Z" },
        { id: "b", session_id: "s2", number: 2, label: " Ana ", closed_at: "2026-11-27T14:00:00Z" },
      ],
      sessions: [
        { id: "s1", table_id: "t1" },
        { id: "s2", table_id: "t2" },
      ],
      tables: [
        { id: "t1", label: "T1" },
        { id: "t2", label: "T2" },
      ],
      tenders: [
        { check_id: "a", amount_cents: 1000, tip_cents: 200, status: "recorded" },
        { check_id: "a", amount_cents: 500, tip_cents: 0, status: "reversed" },
        { check_id: "b", amount_cents: 2000, tip_cents: 0, status: "recorded" },
      ],
    });
    expect(list).toEqual([
      {
        id: "b",
        tableLabel: "T2",
        number: 2,
        label: "Ana",
        closedAt: "2026-11-27T14:00:00Z",
        paidCents: 2000,
        tipsCents: 0,
      },
      {
        id: "a",
        tableLabel: "T1",
        number: 1,
        label: null,
        closedAt: "2026-11-27T12:00:00Z",
        paidCents: 1000,
        tipsCents: 200,
      },
    ]);
  });
});
