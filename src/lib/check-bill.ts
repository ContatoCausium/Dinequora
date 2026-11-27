import type { SessionCheck } from "./dining-room";

/**
 * The printed bill of a check (what a server hands over when the guests ask for the check). Pure: it
 * returns a self-contained HTML document printed from a hidden iframe, so the app's own styles never
 * leak in. Tip suggestions are on the subtotal before tax (US custom).
 */
export interface BillLabels {
  title: string;
  table: string;
  check: string;
  guests: string;
  server: string;
  round: string;
  subtotal: string;
  tax: string;
  total: string;
  paid: string;
  balance: string;
  tipTitle: string;
  tipLine: (percent: number, tip: string, total: string) => string;
  thanks: string;
  printedAt: string;
}

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const esc = escapeHtml;

export function checkBillTotals(check: SessionCheck) {
  const live = check.rounds.filter((r) => r.status !== "cancelled");
  const subtotalCents = live.reduce(
    (n, r) => n + r.items.reduce((m, i) => m + i.subtotalCents, 0),
    0,
  );
  const totalCents = live.reduce((n, r) => n + r.totalCents, 0);
  return {
    subtotalCents,
    taxCents: totalCents - subtotalCents,
    totalCents,
    paidCents: check.paidCents,
    balanceCents: check.balanceCents,
  };
}

export function checkBillHtml(input: {
  lang: string;
  restaurant: string;
  store: string;
  tableLabel: string;
  checkName: string;
  guests: number;
  serverName: string | null;
  check: SessionCheck;
  labels: BillLabels;
  money: (cents: number) => string;
  printedAt: string;
}): string {
  const { labels: L, money } = input;
  const t = checkBillTotals(input.check);
  const rows = input.check.rounds
    .filter((r) => r.status !== "cancelled")
    .flatMap((r) =>
      r.items.map(
        (i) =>
          `<tr><td>${i.quantity} × ${esc(i.name)}${
            i.modifiers.length ? `<div class="mod">${esc(i.modifiers.join(", "))}</div>` : ""
          }</td><td class="n">${esc(money(i.subtotalCents))}</td></tr>`,
      ),
    )
    .join("");
  const tips = [15, 18, 20]
    .map((p) => {
      const tip = Math.round((t.subtotalCents * p) / 100);
      return `<li>${esc(L.tipLine(p, money(tip), money(t.totalCents + tip)))}</li>`;
    })
    .join("");
  return `<!DOCTYPE html><html lang="${esc(input.lang)}"><head><meta charset="utf-8"><title>${esc(L.title)}</title>
<style>
  @page { margin: 8mm; }
  body { font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; color: #000; max-width: 80mm; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
  .c { text-align: center; } .m { margin: 8px 0; } .mod { font-size: 11px; color: #333; padding-left: 12px; }
  table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 2px 0; }
  .n { text-align: right; white-space: nowrap; padding-left: 8px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  .tot td { font-weight: 700; font-size: 15px; } ul { padding-left: 16px; margin: 4px 0; }
</style></head><body>
<h1>${esc(input.restaurant)}</h1>
<div class="c">${esc(input.store)}</div>
<hr>
<div>${esc(L.table)}: <b>${esc(input.tableLabel)}</b> · ${esc(L.check)}: <b>${esc(input.checkName)}</b></div>
<div>${esc(L.guests)}: ${input.guests}${input.serverName ? ` · ${esc(L.server)}: ${esc(input.serverName)}` : ""}</div>
<hr>
<table>${rows}</table>
<hr>
<table>
  <tr><td>${esc(L.subtotal)}</td><td class="n">${esc(money(t.subtotalCents))}</td></tr>
  <tr><td>${esc(L.tax)}</td><td class="n">${esc(money(t.taxCents))}</td></tr>
  <tr class="tot"><td>${esc(L.total)}</td><td class="n">${esc(money(t.totalCents))}</td></tr>
  ${t.paidCents > 0 ? `<tr><td>${esc(L.paid)}</td><td class="n">${esc(money(t.paidCents))}</td></tr><tr class="tot"><td>${esc(L.balance)}</td><td class="n">${esc(money(t.balanceCents))}</td></tr>` : ""}
</table>
<hr>
<div>${esc(L.tipTitle)}</div>
<ul>${tips}</ul>
<hr>
<div class="c m">${esc(L.thanks)}</div>
<div class="c" style="font-size:11px">${esc(L.printedAt)} ${esc(input.printedAt)}</div>
</body></html>`;
}

/** Prints an HTML document from a hidden iframe (removed afterwards). Browser only. */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow.addEventListener("afterprint", done);
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(done, 60_000);
}
