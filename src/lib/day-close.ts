import { escapeHtml as esc } from "./check-bill";
import type { DaySummary } from "./dining-room";

/**
 * The printed day close of the floor (80 mm, from a hidden iframe like the check bill): checks closed,
 * what came in by payment method with its tips, the total, and the tips owed to each server. Printed
 * during the day it says it is partial. Pure: it returns a self-contained HTML document.
 */
export interface DayCloseLabels {
  title: string;
  day: string;
  partial: string;
  checksClosed: string;
  byMethod: string;
  method: (key: string) => string;
  tips: string;
  received: string;
  tipsTotal: string;
  byServer: string;
  unknownServer: string;
  tipsNote: string;
  printedAt: string;
}

export function dayCloseHtml(input: {
  lang: string;
  restaurant: string;
  store: string;
  summary: DaySummary;
  dayLabel: string;
  partial: boolean;
  labels: DayCloseLabels;
  money: (cents: number) => string;
  printedAt: string;
}): string {
  const { summary: d, labels: L, money } = input;
  const methods = d.byMethod
    .map(
      (m) =>
        `<tr><td>${esc(L.method(m.method))} (${m.tenders})</td><td class="n">${esc(money(m.amountCents))}</td></tr>` +
        (m.tipsCents > 0
          ? `<tr class="sub"><td>${esc(L.tips)}</td><td class="n">${esc(money(m.tipsCents))}</td></tr>`
          : ""),
    )
    .join("");
  const servers = d.byServer
    .map(
      (s) =>
        `<tr><td>${esc(s.name ?? L.unknownServer)}</td><td class="n">${esc(money(s.tipsCents))}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html lang="${esc(input.lang)}"><head><meta charset="utf-8"><title>${esc(L.title)}</title>
<style>
  @page { margin: 8mm; }
  body { font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; color: #000; max-width: 80mm; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; } h2 { font-size: 13px; margin: 6px 0 2px; }
  .c { text-align: center; } table { width: 100%; border-collapse: collapse; } td { padding: 2px 0; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; padding-left: 8px; } .sub td { font-size: 11px; color: #333; padding-left: 12px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; } .tot td { font-weight: 700; font-size: 15px; }
</style></head><body>
<h1>${esc(input.restaurant)}</h1>
<div class="c">${esc(input.store)}</div>
<div class="c"><b>${esc(L.title)}</b> · ${esc(L.day)} ${esc(input.dayLabel)}</div>
${input.partial ? `<div class="c">${esc(L.partial)}</div>` : ""}
<hr>
<table><tr><td>${esc(L.checksClosed)}</td><td class="n">${d.checksClosed}</td></tr></table>
<hr>
<h2>${esc(L.byMethod)}</h2>
<table>${methods}</table>
<hr>
<table>
  <tr class="tot"><td>${esc(L.received)}</td><td class="n">${esc(money(d.receivedCents))}</td></tr>
  <tr><td>${esc(L.tipsTotal)}</td><td class="n">${esc(money(d.tipsCents))}</td></tr>
</table>
${
  servers
    ? `<hr><h2>${esc(L.byServer)}</h2><table>${servers}</table><div style="font-size:11px">${esc(L.tipsNote)}</div>`
    : ""
}
<hr>
<div class="c" style="font-size:11px">${esc(L.printedAt)} ${esc(input.printedAt)}</div>
</body></html>`;
}
