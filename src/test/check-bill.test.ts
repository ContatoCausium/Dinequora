import { describe, expect, it } from "vitest";
import { checkBillHtml, checkBillTotals } from "@/lib/check-bill";
import type { SessionCheck } from "@/lib/dining-room";

const check = (over: Partial<SessionCheck> = {}): SessionCheck => ({
  id: "c1",
  number: 2,
  label: "Ana",
  rounds: [
    {
      orderId: "o1",
      roundNo: 1,
      firedAt: "2026-11-27T12:00:00Z",
      status: "new",
      totalCents: 1700,
      items: [
        {
          name: "QA Burger",
          quantity: 1,
          subtotalCents: 1600,
          modifiers: ["Medium", "Bacon"],
          notes: null,
        },
      ],
    },
    {
      orderId: "o2",
      roundNo: 2,
      firedAt: "2026-11-27T12:10:00Z",
      status: "cancelled",
      totalCents: 428,
      items: [{ name: "Voided soda", quantity: 1, subtotalCents: 400, modifiers: [], notes: null }],
    },
  ],
  tenders: [],
  paidCents: 0,
  balanceCents: 1700,
  liveTotalCents: 1700,
  liveRounds: 1,
  ...over,
});
const labels = {
  title: "Check · T2",
  table: "Table",
  check: "Check",
  guests: "Guests",
  server: "Server",
  round: "Round",
  subtotal: "Subtotal",
  tax: "Sales tax",
  total: "Total",
  paid: "Paid",
  balance: "Balance due",
  tipTitle: "Tip suggestions (on the subtotal):",
  tipLine: (p: number, tip: string, total: string) => `${p}%: ${tip} → total ${total}`,
  thanks: "Thank you!",
  printedAt: "Printed",
};
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const bill = (c: SessionCheck, restaurant = "Test Kitchen") =>
  checkBillHtml({
    lang: "en-US",
    restaurant,
    store: "Downtown",
    tableLabel: "T2",
    checkName: "Ana",
    guests: 3,
    serverName: "Sam",
    check: c,
    labels,
    money,
    printedAt: "Nov 27, 12:30",
  });

describe("printed check", () => {
  it("totals only live rounds: subtotal, tax, total", () => {
    expect(checkBillTotals(check())).toEqual({
      subtotalCents: 1600,
      taxCents: 100,
      totalCents: 1700,
      paidCents: 0,
      balanceCents: 1700,
    });
  });

  it("lists live items with options, totals and tips on the subtotal; a voided round is left out", () => {
    const html = bill(check());
    expect(html).toContain("1 × QA Burger");
    expect(html).toContain("Medium, Bacon");
    expect(html).not.toContain("Voided soda");
    expect(html).toContain("$16.00");
    expect(html).toContain("$1.00");
    expect(html).toContain("$17.00");
    // 15% of 16.00 = 2.40 → 19.40; 20% = 3.20 → 20.20
    expect(html).toContain("15%: $2.40 → total $19.40");
    expect(html).toContain("20%: $3.20 → total $20.20");
    expect(html).not.toContain("Balance due");
  });

  it("shows paid and balance after a partial payment", () => {
    const html = bill(check({ paidCents: 1000, balanceCents: 700 }));
    expect(html).toContain("Paid");
    expect(html).toContain("$10.00");
    expect(html).toContain("Balance due");
    expect(html).toContain("$7.00");
  });

  it("escapes names, so a product or restaurant name can never inject markup", () => {
    const evil = check({
      rounds: [
        {
          orderId: "o1",
          roundNo: 1,
          firedAt: "2026-11-27T12:00:00Z",
          status: "new",
          totalCents: 100,
          items: [
            {
              name: "<script>alert(1)</script>",
              quantity: 1,
              subtotalCents: 100,
              modifiers: [],
              notes: null,
            },
          ],
        },
      ],
    });
    const html = bill(evil, 'Joe\'s "Diner" <b>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Joe&#39;s &quot;Diner&quot; &lt;b&gt;");
  });
});
