import { Clock, CookingPot, Receipt, Utensils } from "lucide-react";
import { formatUsd } from "../../config/pricing";
import { pick, useLocale, useT } from "../../i18n/locale";
import { cx } from "../ui";
import { segment } from "./scene";

/**
 * Charts and live UI driven by scroll progress. All figures are illustrative sample
 * data and every card says so; the structures (statuses, columns, report lines) mirror
 * what the Dinequora app shows.
 */

const ease = (x: number) => 1 - Math.pow(1 - x, 3);

function SampleTag() {
  const t = useT();
  return (
    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-mist/70">
      {t("Sample data", "Dados de exemplo")}
    </span>
  );
}

function GlassCard({ title, icon, children, className }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-white/[0.09] bg-[#0b1424]/75 p-5 text-offwhite shadow-[0_40px_100px_-40px_rgb(0_0_0/0.9)] backdrop-blur-xl sm:p-6",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-emerald/12 text-emerald ring-1 ring-emerald/20">{icon}</span>
        <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
        <span className="ml-auto shrink-0">
          <SampleTag />
        </span>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- Stock levels */

type StockRow = { name: [string, string]; unit: [string, string]; level: number; min: number };

const STOCK: StockRow[] = [
  { name: ["Salmon fillet", "Filé de salmão"], unit: ["kg", "kg"], level: 0.72, min: 0.3 },
  { name: ["Arborio rice", "Arroz arbóreo"], unit: ["kg", "kg"], level: 0.55, min: 0.25 },
  { name: ["Heavy cream", "Creme de leite fresco"], unit: ["L", "L"], level: 0.18, min: 0.3 },
  { name: ["Lemons", "Limões-sicilianos"], unit: ["un", "un"], level: 0.64, min: 0.2 },
  { name: ["Microgreens", "Brotos"], unit: ["box", "cx"], level: 0, min: 0.25 },
  { name: ["Olive oil", "Azeite"], unit: ["L", "L"], level: 0.41, min: 0.2 },
];

export function StockLevels({ p }: { p: number }) {
  const { locale } = useLocale();
  const t = useT();
  const k = ease(segment(p, 0.05, 0.55));
  const flagged = segment(p, 0.45, 0.6) > 0;
  const po = segment(p, 0.62, 0.75) > 0;
  return (
    <GlassCard title={t("Inventory · Midtown", "Estoque · Midtown")} icon={<CookingPot className="size-4" strokeWidth={1.75} />}>
      <ul className="space-y-3.5">
        {STOCK.map((r) => {
          const status = r.level === 0 ? "out" : r.level < r.min ? "low" : "normal";
          const color = !flagged || status === "normal" ? "bg-emerald" : status === "low" ? "bg-amber" : "bg-rose";
          return (
            <li key={r.name[0]} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3 text-[13px]">
              <span className="truncate text-offwhite/90">{pick(locale, r.name[0], r.name[1])}</span>
              <span className="relative h-2 rounded-full bg-white/[0.06]">
                <span
                  className={cx("absolute inset-y-0 left-0 rounded-full transition-colors duration-500", color)}
                  style={{ width: `${Math.max(r.level * k * 100, r.level === 0 ? 0 : 2)}%` }}
                />
                <span className="absolute -inset-y-1 w-px bg-offwhite/40" style={{ left: `${r.min * 100}%` }} aria-hidden />
              </span>
              <span
                className={cx(
                  "w-[4.6rem] rounded-full px-2 py-0.5 text-center text-[10.5px] font-medium transition-opacity duration-500",
                  status === "normal" && "bg-emerald/10 text-emerald",
                  status === "low" && "bg-amber/12 text-amber",
                  status === "out" && "bg-rose/12 text-rose",
                  flagged ? "opacity-100" : "opacity-0",
                )}
              >
                {status === "normal" ? t("Normal", "Normal") : status === "low" ? t("Low", "Baixo") : t("Out", "Zerado")}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-center gap-2 text-[11px] text-mist/70">
        <span className="h-3 w-px bg-offwhite/40" /> {t("Minimum level", "Estoque mínimo")}
      </div>
      <div
        className={cx(
          "mt-5 flex items-center justify-between gap-3 rounded-xl border border-emerald/25 bg-emerald/[0.07] px-4 py-3 text-[13px] transition-all duration-700",
          po ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
      >
        <span>
          <span className="font-semibold">{t("Purchase order", "Pedido de compra")} PO-1042</span>
          <span className="block text-[11.5px] text-mist">{t("2 items · Green Valley Produce", "2 itens · Green Valley Produce")}</span>
        </span>
        <span className="rounded-lg bg-emerald px-2.5 py-1 text-[11.5px] font-semibold text-navy">{t("Send", "Enviar")}</span>
      </div>
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ Order flow */

type FlowTicket = { id: string; where: [string, string]; items: [string, string]; start: number };

const TICKETS: FlowTicket[] = [
  { id: "#1041", where: ["Table 12", "Mesa 12"], items: ["2× Seared salmon", "2× Salmão grelhado"], start: 0 },
  { id: "#1042", where: ["Takeout", "Para viagem"], items: ["1× Wild mushroom risotto", "1× Risoto de cogumelos"], start: 0.08 },
  { id: "#1043", where: ["Table 4", "Mesa 4"], items: ["3× Short rib", "3× Costela"], start: 0.16 },
  { id: "#1044", where: ["Bar 2", "Balcão 2"], items: ["1× Burrata", "1× Burrata"], start: 0.24 },
  { id: "#1045", where: ["Table 3", "Mesa 3"], items: ["2× Lemon tart", "2× Torta de limão"], start: 0.32 },
  { id: "#1046", where: ["Delivery", "Delivery"], items: ["2× Chicken paillard", "2× Paillard de frango"], start: 0.4 },
];

const STAGES = 4; // 0 waiting at POS, 1 new, 2 in preparation, 3 ready

export function OrderFlow({ p }: { p: number }) {
  const { locale } = useLocale();
  const t = useT();
  const stageOf = (tk: FlowTicket) => Math.min(STAGES - 1, Math.max(-1, Math.floor((p - tk.start) / 0.14)));
  const columns = [
    { stage: 1, label: t("New", "Novos"), icon: <Receipt className="size-3.5" />, tone: "text-sky-300" },
    { stage: 2, label: t("In preparation", "Em preparo"), icon: <Clock className="size-3.5" />, tone: "text-amber" },
    { stage: 3, label: t("Ready", "Prontos"), icon: <Utensils className="size-3.5" />, tone: "text-emerald" },
  ];
  const sent = TICKETS.filter((tk) => stageOf(tk) >= 1).length;
  return (
    <GlassCard
      title={t("Kitchen display · live", "Tela da cozinha · ao vivo")}
      icon={<CookingPot className="size-4" strokeWidth={1.75} />}
    >
      <div className="mb-4 flex items-center gap-2 text-[12px] text-mist">
        <span className="live-dot size-1.5 rounded-full bg-emerald" />
        {t(`${sent} of 6 tickets sent from the POS`, `${sent} de 6 pedidos enviados pelo caixa`)}
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
        {columns.map((c) => {
          const list = TICKETS.filter((tk) => stageOf(tk) === c.stage);
          return (
            <div key={c.stage} className="min-h-[15.5rem] min-w-0 rounded-xl bg-white/[0.03] p-1.5 sm:p-2">
              <div className={cx("mb-2 flex items-center gap-1.5 px-1 text-[11px] leading-tight font-semibold", c.tone)}>
                <span className="hidden sm:inline">{c.icon}</span> {c.label}
                <span className="ml-auto text-mist/60 tabular-nums">{list.length}</span>
              </div>
              <ul className="space-y-2">
                {list.map((tk) => (
                  <li key={tk.id} className="flow-in rounded-lg border border-white/[0.07] bg-[#0f1a2c] p-2 text-[11px] sm:p-2.5 sm:text-[11.5px]">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 font-semibold">
                      <span>{tk.id}</span>
                      <span className="truncate font-normal text-mist/70">{pick(locale, tk.where[0], tk.where[1])}</span>
                    </div>
                    <div className="mt-1 truncate text-offwhite/80">{pick(locale, tk.items[0], tk.items[1])}</div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

/* ------------------------------------------------------- Revenue vs expenses */

const WEEK = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  pt: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"],
};
const REVENUE = [3.1, 3.4, 3.9, 4.6, 6.8, 7.9, 5.2]; // thousands, illustrative
const EXPENSES = [2.4, 2.2, 2.6, 2.9, 3.6, 4.1, 3.0];

function path(values: number[], w: number, h: number, max: number) {
  const step = w / (values.length - 1);
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
}

export function RevenueChart({ p }: { p: number }) {
  const { locale } = useLocale();
  const t = useT();
  const draw = ease(segment(p, 0.08, 0.55));
  const totals = ease(segment(p, 0.5, 0.75));
  const W = 520;
  const H = 180;
  const max = 9;
  const revenue = REVENUE.reduce((a, b) => a + b, 0) * 1000;
  const expenses = EXPENSES.reduce((a, b) => a + b, 0) * 1000;
  const money = (v: number) => formatUsd(Math.round(v * totals), locale);
  return (
    <GlassCard title={t("Finance · This week", "Financeiro · Esta semana")} icon={<Receipt className="size-4" strokeWidth={1.75} />}>
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full" role="img" aria-label={t("Revenue and expenses by day, sample data", "Receita e despesas por dia, dados de exemplo")}>
        {[0, 3, 6, 9].map((g) => (
          <line key={g} x1="0" x2={W} y1={H - (g / max) * H} y2={H - (g / max) * H} stroke="rgb(169 185 201 / 0.12)" strokeDasharray="3 5" />
        ))}
        <path d={`${path(REVENUE, W, H, max)} L${W},${H} L0,${H} Z`} fill="url(#rev)" opacity={draw * 0.9} />
        <path d={path(REVENUE, W, H, max)} fill="none" stroke="#10b981" strokeWidth="2.5" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw} strokeLinecap="round" />
        <path d={path(EXPENSES, W, H, max)} fill="none" stroke="#f59e0b" strokeWidth="2" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw} strokeLinecap="round" opacity="0.85" />
        <defs>
          <linearGradient id="rev" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#10b981" stopOpacity="0.28" />
            <stop offset="1" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {WEEK[locale].map((d, i) => (
          <text key={d} x={(i * W) / 6} y={H + 18} textAnchor={i === 0 ? "start" : i === 6 ? "end" : "middle"} fill="rgb(169 185 201 / 0.7)" fontSize="11">
            {d}
          </text>
        ))}
      </svg>
      <div className="mt-3 flex gap-4 text-[11.5px] text-mist">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-emerald" /> {t("Revenue", "Receita")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-amber" /> {t("Expenses", "Despesas")}
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-4 sm:grid-cols-3">
        {[
          { label: t("Revenue", "Receita"), value: money(revenue), tone: "text-offwhite" },
          { label: t("Expenses", "Despesas"), value: money(expenses), tone: "text-offwhite" },
          { label: t("Estimated net", "Resultado estimado"), value: money(revenue - expenses), tone: "text-emerald" },
        ].map((s) => (
          <div key={s.label} className="last:col-span-2 sm:last:col-span-1">
            <dt className="text-[11px] text-mist/80">{s.label}</dt>
            <dd className={cx("mt-1 text-lg font-semibold tabular-nums sm:text-xl", s.tone)}>{s.value}</dd>
          </div>
        ))}
      </dl>
    </GlassCard>
  );
}
