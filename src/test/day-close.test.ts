import { describe, expect, it } from "vitest";
import { dayCloseHtml } from "@/lib/day-close";
import type { DaySummary } from "@/lib/dining-room";

const summary: DaySummary = {
  day: "2026-11-27",
  checksClosed: 2,
  receivedCents: 2284,
  tipsCents: 306,
  byServer: [
    { serverId: "u1", name: "Sam", tipsCents: 306, tenders: 1 },
    { serverId: "u2", name: null, tipsCents: 0, tenders: 1 },
  ],
  byMethod: [
    { method: "cash", amountCents: 584, tipsCents: 0, tenders: 1 },
    { method: "card", amountCents: 1700, tipsCents: 306, tenders: 1 },
  ],
};
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const html = (s: DaySummary, restaurant = "Test Kitchen", partial = true) =>
  dayCloseHtml({
    lang: "en-US",
    restaurant,
    store: "Downtown",
    summary: s,
    dayLabel: "Nov 27, 2026",
    partial,
    money,
    printedAt: "Nov 27, 17:00",
    labels: {
      title: "Day close",
      day: "Day",
      partial: "Partial: the day is still open",
      checksClosed: "Checks closed",
      byMethod: "Received by payment method",
      method: (m) => ({ cash: "Cash", card: "Card" })[m] ?? m,
      tips: "tips",
      received: "Received",
      tipsTotal: "Tips",
      byServer: "Tips by server",
      unknownServer: "unknown",
      tipsNote: "Tips belong to the staff; they are not revenue.",
      printedAt: "Printed",
    },
  });

describe("printed day close", () => {
  it("lists checks, each method with its tips, the total and the tips by server", () => {
    const h = html(summary);
    expect(h).toContain("Day close");
    expect(h).toContain("Partial: the day is still open");
    expect(h).toContain('Checks closed</td><td class="n">2');
    expect(h).toContain('Cash (1)</td><td class="n">$5.84');
    expect(h).toContain('Card (1)</td><td class="n">$17.00');
    expect(h).toContain('tips</td><td class="n">$3.06');
    expect(h).toContain('Received</td><td class="n">$22.84');
    expect(h).toContain('Sam</td><td class="n">$3.06');
    expect(h).toContain("unknown</td>");
  });

  it("not partial: no partial line; no server tips: no server section", () => {
    const h = html({ ...summary, byServer: [] }, "Test Kitchen", false);
    expect(h).not.toContain("Partial");
    expect(h).not.toContain("Tips by server");
  });

  it("escapes names so a restaurant or server name cannot inject markup", () => {
    const h = html(
      {
        ...summary,
        byServer: [
          { serverId: "x", name: "<img src=x onerror=alert(1)>", tipsCents: 1, tenders: 1 },
        ],
      },
      'Joe\'s "Diner" <b>',
    );
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(h).toContain("Joe&#39;s &quot;Diner&quot; &lt;b&gt;");
  });
});
