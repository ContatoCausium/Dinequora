/**
 * Single source of truth for Dinequora pricing (USD), in English and Portuguese.
 *
 * Two separate charges per plan:
 *   1. A one-time implementation fee.
 *   2. A recurring monthly subscription.
 *
 * Amounts live only in `PRICES` below; both languages read them from there.
 * To change pricing, edit only this file. Components and tests read from here.
 * Do not add discounts, per-location surcharges, or promotions here without approval.
 */
import { pick, type Locale } from "../i18n/locale";

export type PlanId = "starter" | "growth" | "enterprise";

export type Money =
  | { kind: "fixed"; amountUsd: number }
  | { kind: "custom"; label: string };

export type ImplementationFee =
  | { kind: "fixed"; amountUsd: number }
  | { kind: "startingAt"; amountUsd: number; note: string };

export type PlanFeature = {
  label: string;
  /** True when the capability is still being rolled out in the product. */
  rollingOut?: boolean;
};

export type Plan = {
  id: PlanId;
  name: string;
  summary: string;
  monthly: Money;
  implementation: ImplementationFee;
  locations: string;
  highlight?: string;
  cta: { label: string; href: string };
  features: readonly PlanFeature[];
};

export const CURRENCY = "USD";

/** Approved amounts in US dollars. `null` monthly = priced by contract. */
export const PRICES = {
  starter: { monthlyUsd: 49, implementationUsd: 149 },
  growth: { monthlyUsd: 119, implementationUsd: 349 },
  enterprise: { monthlyUsd: null, implementationFromUsd: 799 },
} as const;

/** Formats whole US dollars: "$49" in English, "US$ 49" in Portuguese. */
export function formatUsd(amount: number, locale: Locale = "en"): string {
  return new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getPlans(locale: Locale): readonly Plan[] {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const bookDemo = t("Book a Demo", "Agendar demo");
  return [
    {
      id: "starter",
      name: "Starter",
      summary: t(
        "Everything a single restaurant needs to run service, the kitchen, and the books.",
        "Tudo o que um restaurante precisa para tocar o salão, a cozinha e as finanças.",
      ),
      monthly: { kind: "fixed", amountUsd: PRICES.starter.monthlyUsd },
      implementation: { kind: "fixed", amountUsd: PRICES.starter.implementationUsd },
      locations: t("1 restaurant location", "1 unidade"),
      cta: { label: bookDemo, href: "#demo" },
      features: [
        { label: t("1 restaurant location", "1 unidade") },
        { label: t("POS and order management", "PDV e gestão de pedidos") },
        { label: t("Kitchen Display System", "Tela da cozinha (KDS)") },
        { label: t("Menu management", "Gestão de cardápio") },
        { label: t("Inventory tracking", "Controle de estoque") },
        { label: t("Expense management", "Gestão de despesas") },
        { label: t("Financial dashboard", "Painel financeiro") },
        { label: t("Employee accounts and permissions", "Contas e permissões da equipe") },
        { label: t("Standard reports", "Relatórios padrão") },
      ],
    },
    {
      id: "growth",
      name: "Growth",
      summary: t(
        "For operators running more than one room who need cost control across every location.",
        "Para quem opera mais de uma casa e precisa controlar custos em todas as unidades.",
      ),
      monthly: { kind: "fixed", amountUsd: PRICES.growth.monthlyUsd },
      implementation: { kind: "fixed", amountUsd: PRICES.growth.implementationUsd },
      locations: t("Up to 3 restaurant locations", "Até 3 unidades"),
      highlight: t("Most Popular", "Mais popular"),
      cta: { label: bookDemo, href: "#demo" },
      features: [
        { label: t("Up to 3 restaurant locations", "Até 3 unidades") },
        { label: t("Everything in Starter", "Tudo do Starter") },
        { label: t("Multi-location management", "Gestão de várias unidades") },
        { label: t("Advanced inventory and purchasing", "Estoque e compras avançados") },
        { label: t("Recipe and food cost management", "Fichas técnicas e custo de alimentos"), rollingOut: true },
        { label: t("Advanced financial reports", "Relatórios financeiros avançados") },
        { label: t("Employee access management", "Gestão de acessos da equipe") },
        { label: t("Business performance analytics", "Análise de desempenho do negócio"), rollingOut: true },
      ],
    },
    {
      id: "enterprise",
      name: "Enterprise",
      summary: t(
        "For restaurant groups that need centralized control, tailored onboarding, and a contract.",
        "Para grupos de restaurantes que precisam de controle centralizado, implantação sob medida e contrato.",
      ),
      monthly: { kind: "custom", label: t("Custom", "Sob consulta") },
      implementation: {
        kind: "startingAt",
        amountUsd: PRICES.enterprise.implementationFromUsd,
        note: t("Subject to scope and contract", "Sujeito a escopo e contrato"),
      },
      locations: t("Up to 50 locations, subject to contract", "Até 50 unidades, conforme contrato"),
      cta: { label: t("Talk to Sales", "Falar com vendas"), href: "#demo" },
      features: [
        { label: t("Up to 50 locations, subject to contract", "Até 50 unidades, conforme contrato") },
        { label: t("Everything in Growth", "Tudo do Growth") },
        { label: t("Centralized management", "Gestão centralizada") },
        { label: t("Advanced permissions", "Permissões avançadas") },
        { label: t("Customized onboarding", "Implantação personalizada") },
        { label: t("Data migration assistance", "Apoio na migração de dados") },
        { label: t("Custom integrations, subject to availability", "Integrações personalizadas, conforme disponibilidade") },
        { label: t("Dedicated account support, subject to contract", "Atendimento dedicado, conforme contrato") },
      ],
    },
  ];
}

/** English plans (default language). */
export const plans = getPlans("en");

/** "$149" / "From $799" (or the Portuguese equivalent) for a plan's implementation fee. */
export function implementationPrice(fee: ImplementationFee, locale: Locale): string {
  const amount = formatUsd(fee.amountUsd, locale);
  return fee.kind === "fixed" ? amount : `${pick(locale, "From", "A partir de")} ${amount}`;
}

/** Rows of the comparison table. `true` = included, string = specific value. */
export type ComparisonValue = boolean | string;
export type ComparisonRow = {
  label: string;
  rollingOut?: boolean;
  values: Record<PlanId, ComparisonValue>;
};
export type ComparisonGroup = { title: string; rows: readonly ComparisonRow[] };

export function getComparison(locale: Locale): readonly ComparisonGroup[] {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const usd = (n: number) => formatUsd(n, locale);
  const perMonth = t(" / mo", "/mês");
  const all = { starter: true, growth: true, enterprise: true };
  const growthUp = { starter: false, growth: true, enterprise: true };
  const enterpriseOnly = { starter: false, growth: false, enterprise: true };
  return [
    {
      title: t("Plan basics", "Básico do plano"),
      rows: [
        {
          label: t("Monthly subscription", "Assinatura mensal"),
          values: {
            starter: `${usd(PRICES.starter.monthlyUsd)}${perMonth}`,
            growth: `${usd(PRICES.growth.monthlyUsd)}${perMonth}`,
            enterprise: t("Custom", "Sob consulta"),
          },
        },
        {
          label: t("One-time implementation", "Implantação (pagamento único)"),
          values: {
            starter: usd(PRICES.starter.implementationUsd),
            growth: usd(PRICES.growth.implementationUsd),
            enterprise: `${t("From", "A partir de")} ${usd(PRICES.enterprise.implementationFromUsd)}`,
          },
        },
        {
          label: t("Restaurant locations", "Unidades"),
          values: { starter: "1", growth: t("Up to 3", "Até 3"), enterprise: t("Up to 50*", "Até 50*") },
        },
      ],
    },
    {
      title: t("Operations", "Operação"),
      rows: [
        { label: t("Point of sale and order workflow", "PDV e fluxo de pedidos"), values: all },
        { label: t("Kitchen Display System", "Tela da cozinha (KDS)"), values: all },
        { label: t("Menu management", "Gestão de cardápio"), values: all },
      ],
    },
    {
      title: t("Inventory & purchasing", "Estoque e compras"),
      rows: [
        { label: t("Inventory tracking and stock movements", "Controle de estoque e movimentações"), values: all },
        { label: t("Suppliers, purchase orders, and receiving", "Fornecedores, pedidos de compra e recebimento"), values: growthUp },
        { label: t("Recipe and food cost management", "Fichas técnicas e custo de alimentos"), rollingOut: true, values: growthUp },
      ],
    },
    {
      title: t("Finance", "Financeiro"),
      rows: [
        { label: t("Expense management", "Gestão de despesas"), values: all },
        { label: t("Financial dashboard", "Painel financeiro"), values: all },
        { label: t("Standard reports", "Relatórios padrão"), values: all },
        { label: t("Advanced financial reports", "Relatórios financeiros avançados"), values: growthUp },
      ],
    },
    {
      title: t("Team & control", "Equipe e controle"),
      rows: [
        { label: t("Employee accounts and permissions", "Contas e permissões da equipe"), values: all },
        { label: t("Location-specific access", "Acesso por unidade"), values: growthUp },
        { label: t("Multi-location management", "Gestão de várias unidades"), values: growthUp },
        {
          label: t("Centralized management and advanced permissions", "Gestão centralizada e permissões avançadas"),
          values: enterpriseOnly,
        },
        { label: t("Business performance analytics", "Análise de desempenho do negócio"), rollingOut: true, values: growthUp },
      ],
    },
    {
      title: t("Onboarding & support", "Implantação e suporte"),
      rows: [
        { label: t("Guided implementation", "Implantação guiada"), values: all },
        { label: t("Customized onboarding", "Implantação personalizada"), values: enterpriseOnly },
        { label: t("Data migration assistance", "Apoio na migração de dados"), values: enterpriseOnly },
        {
          label: t("Custom integrations", "Integrações personalizadas"),
          values: { starter: false, growth: false, enterprise: t("Subject to availability", "Conforme disponibilidade") },
        },
        {
          label: t("Dedicated account support", "Atendimento dedicado"),
          values: { starter: false, growth: false, enterprise: t("Subject to contract", "Conforme contrato") },
        },
      ],
    },
  ];
}

/** English comparison table (default language). */
export const comparison = getComparison("en");
