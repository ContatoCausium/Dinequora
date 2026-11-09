import { ArrowDownToLine, ClipboardList, FileSpreadsheet, PackageCheck, Receipt, Truck } from "lucide-react";
import { Reveal, SectionHeader } from "../components/ui";
import { AppWindow, ScaledFrame } from "../components/mockups/frame";
import { InventoryPanel } from "../components/mockups/panels";
import { pick, useLocale } from "../i18n/locale";

const inventoryPoints = {
  en: [
    { icon: ClipboardList, title: "Know what's on hand", body: "Quantities and minimums for every item, with low and out-of-stock flags." },
    { icon: Truck, title: "Order from suppliers", body: "Purchase orders tracked from draft to sent to received." },
    { icon: PackageCheck, title: "Receive with confidence", body: "Record full or partial deliveries against the original order." },
  ],
  pt: [
    { icon: ClipboardList, title: "Saiba o que tem", body: "Quantidade e mínimo de cada item, com alertas de estoque baixo e zerado." },
    { icon: Truck, title: "Compre dos fornecedores", body: "Pedidos de compra acompanhados do rascunho ao envio e ao recebimento." },
    { icon: PackageCheck, title: "Receba com segurança", body: "Registre entregas totais ou parciais conferindo com o pedido original." },
  ],
};

const financePoints = {
  en: [
    { icon: Receipt, title: "Every expense, categorized", body: "Rent, payroll, utilities, ingredients, and more, with due dates and status." },
    { icon: ArrowDownToLine, title: "Revenue as it's recorded", body: "Completed sales post revenue automatically, by location." },
    { icon: FileSpreadsheet, title: "Reports your accountant wants", body: "Seven report types, exportable to CSV, spreadsheet, or PDF." },
  ],
  pt: [
    { icon: Receipt, title: "Cada despesa na sua categoria", body: "Aluguel, folha, contas de consumo, ingredientes e mais, com vencimento e status." },
    { icon: ArrowDownToLine, title: "Faturamento conforme é registrado", body: "Vendas concluídas lançam o faturamento automaticamente, por unidade." },
    { icon: FileSpreadsheet, title: "Os relatórios que o contador pede", body: "Sete tipos de relatório, exportáveis em CSV, planilha ou PDF." },
  ],
};

export function CostControl() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return (
    <section aria-labelledby="cost-title" className="relative bg-navy py-24 sm:py-32">
      <div className="container-page">
        <SectionHeader
          id="cost-title"
          eyebrow={t("Financial control & inventory", "Controle financeiro e estoque")}
          title={
            <>
              {t("Protect your margins ", "Proteja suas margens ")}
              <span className="accent-serif text-emerald">{t("before service starts.", "antes de o serviço começar.")}</span>
            </>
          }
          lead={t(
            "Food and labor are your two biggest costs. Dinequora puts stock, purchasing, and spending side by side so you can act on them every day, not just at month-end.",
            "Alimentos e mão de obra são seus dois maiores custos. O Dinequora coloca estoque, compras e gastos lado a lado para você agir todos os dias, não só no fechamento do mês.",
          )}
        />

        <div className="mt-16 grid gap-6 lg:grid-cols-12">
          {/* Inventory column */}
          <Reveal className="surface-dark relative overflow-hidden rounded-3xl lg:col-span-7">
            <div className="p-7 sm:p-10">
              <p className="eyebrow text-emerald">{t("Inventory & purchasing", "Estoque e compras")}</p>
              <div className="mt-6 grid gap-6 sm:grid-cols-3">
                {inventoryPoints[locale].map(({ icon: Icon, title, body }) => (
                  <div key={title}>
                    <Icon aria-hidden className="size-5 text-mist" strokeWidth={1.75} />
                    <h3 className="mt-3 font-semibold text-offwhite">{title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-mist">{body}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="pl-7 sm:pl-10">
              <ScaledFrame width={980}>
                <AppWindow active="inventory" compactNav>
                  <InventoryPanel rows={5} />
                </AppWindow>
              </ScaledFrame>
            </div>
          </Reveal>

          {/* Finance column */}
          <Reveal delay={120} className="relative flex flex-col overflow-hidden rounded-3xl border border-line-dark lg:col-span-5">
            <div className="relative h-60 shrink-0 overflow-hidden sm:h-72">
              <img
                src="/images/dish-dark.webp"
                alt={t("Plated dish on a dark table", "Prato servido sobre uma mesa escura")}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-[1.6s] ease-out hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-navy-900 to-transparent" aria-hidden />
            </div>
            <div className="flex-1 bg-navy-900 p-7 sm:p-10">
              <p className="eyebrow text-emerald">{t("Financial management", "Gestão financeira")}</p>
              <ul className="mt-6 space-y-6">
                {financePoints[locale].map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-emerald">
                      <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
                    </span>
                    <div>
                      <h3 className="font-semibold text-offwhite">{title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-mist">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
