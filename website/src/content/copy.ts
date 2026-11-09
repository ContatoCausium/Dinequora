import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Bot, LineChart, PackageSearch, ReceiptText, Sparkles } from "lucide-react";
import { formatUsd, PRICES } from "../config/pricing";
import { pick, type Locale } from "../i18n/locale";

export type Step = { number: string; title: string; body: string; deliverables: readonly string[] };

export function getImplementationSteps(locale: Locale): readonly Step[] {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return [
    {
      number: "01",
      title: t("Discovery", "Diagnóstico"),
      body: t(
        "We learn how your restaurant runs today: service style, locations, menu, suppliers, and who needs access to what.",
        "Entendemos como seu restaurante funciona hoje: tipo de serviço, unidades, cardápio, fornecedores e quem precisa acessar o quê.",
      ),
      deliverables: t(
        ["Operations walkthrough", "Setup plan for your locations"],
        ["Mapeamento da operação", "Plano de configuração das unidades"],
      ),
    },
    {
      number: "02",
      title: t("Configuration", "Configuração"),
      body: t(
        "We configure your account, locations and hours, menu and modifiers, inventory items, and suppliers.",
        "Configuramos sua conta, unidades e horários, cardápio e complementos, itens de estoque e fornecedores.",
      ),
      deliverables: t(
        ["Account and locations", "Menu and inventory loaded"],
        ["Conta e unidades", "Cardápio e estoque cadastrados"],
      ),
    },
    {
      number: "03",
      title: t("Team Setup", "Equipe"),
      body: t(
        "Owners, managers, and staff receive their accounts with the right roles and location access from day one.",
        "Donos, gerentes e funcionários recebem suas contas com as funções e o acesso às unidades certos desde o primeiro dia.",
      ),
      deliverables: t(
        ["Roles and permissions", "Location access per person"],
        ["Funções e permissões", "Acesso às unidades por pessoa"],
      ),
    },
    {
      number: "04",
      title: t("Training", "Treinamento"),
      body: t(
        "Remote, role-based sessions so owners, managers, and front- and back-of-house staff know their screens.",
        "Sessões remotas por função, para que donos, gerentes, salão e cozinha dominem as telas que vão usar.",
      ),
      deliverables: t(
        ["Owner and manager session", "POS and kitchen session"],
        ["Sessão para donos e gerentes", "Sessão de PDV e cozinha"],
      ),
    },
    {
      number: "05",
      title: t("Go Live", "Entrada em operação"),
      body: t(
        "We validate the configuration with you, then stay close through your first days running on Dinequora.",
        "Validamos a configuração com você e acompanhamos de perto os primeiros dias de operação com o Dinequora.",
      ),
      deliverables: t(["Configuration review", "Launch support"], ["Revisão da configuração", "Suporte no lançamento"]),
    },
  ];
}

export type ImplementationRow = { label: string; starter: string; growth: string; enterprise: string };

export function getImplementationIncludes(locale: Locale): readonly ImplementationRow[] {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const included = t("Included", "Incluso");
  return [
    { label: t("Discovery and setup plan", "Diagnóstico e plano de configuração"), starter: included, growth: included, enterprise: included },
    {
      label: t("Account, menu, and inventory configuration", "Configuração de conta, cardápio e estoque"),
      starter: t("1 location", "1 unidade"),
      growth: t("Up to 3 locations", "Até 3 unidades"),
      enterprise: t("Scoped per contract", "Definido em contrato"),
    },
    {
      label: t("Team accounts, roles, and permissions", "Contas, funções e permissões da equipe"),
      starter: included,
      growth: t("Included, per location", "Incluso, por unidade"),
      enterprise: t("Advanced permissions", "Permissões avançadas"),
    },
    {
      label: t("Remote training sessions", "Sessões de treinamento remotas"),
      starter: included,
      growth: included,
      enterprise: t("Customized program", "Programa personalizado"),
    },
    { label: t("Go-live validation", "Validação antes de entrar em operação"), starter: included, growth: included, enterprise: included },
    { label: t("Data migration assistance", "Apoio na migração de dados"), starter: "—", growth: "—", enterprise: included },
  ];
}

export type RoadmapItem = { title: string; body: string; icon: LucideIcon };

export function getAiRoadmap(locale: Locale): readonly RoadmapItem[] {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return [
    {
      title: t("AI Business Insights", "Insights de negócio com IA"),
      body: t(
        "Plain-language explanations of what changed in your numbers this week, and why it matters.",
        "Explicações em linguagem simples sobre o que mudou nos seus números na semana e por que isso importa.",
      ),
      icon: Sparkles,
    },
    {
      title: t("AI Sales Forecasting", "Previsão de vendas com IA"),
      body: t(
        "Expected demand by day and daypart, built from your own sales history.",
        "Demanda esperada por dia e por turno, calculada a partir do seu próprio histórico de vendas.",
      ),
      icon: LineChart,
    },
    {
      title: t("AI Inventory Recommendations", "Recomendações de estoque com IA"),
      body: t(
        "Suggested order quantities based on usage, par levels, and upcoming demand.",
        "Sugestões de quantidade de compra com base no consumo, no estoque mínimo e na demanda prevista.",
      ),
      icon: PackageSearch,
    },
    {
      title: t("AI Expense Analysis", "Análise de despesas com IA"),
      body: t(
        "Spot unusual spending, rising supplier costs, and categories drifting off budget.",
        "Identifique gastos fora do padrão, fornecedores encarecendo e categorias saindo do orçamento.",
      ),
      icon: ReceiptText,
    },
    {
      title: t("AI Restaurant Assistant", "Assistente de IA para o restaurante"),
      body: t(
        "Ask questions about your operation in plain English and get answers grounded in your data.",
        "Faça perguntas sobre a sua operação em linguagem natural e receba respostas baseadas nos seus dados.",
      ),
      icon: Bot,
    },
    {
      title: t("AI Operational Alerts", "Alertas operacionais com IA"),
      body: t(
        "Proactive warnings when something needs attention before it becomes a problem in service.",
        "Avisos antecipados quando algo precisa de atenção, antes de virar problema no serviço.",
      ),
      icon: AlertTriangle,
    },
  ];
}

export type Faq = { q: string; a: string };

export function getFaqs(locale: Locale): readonly Faq[] {
  const usd = (n: number) => formatUsd(n, locale);
  const s = PRICES.starter;
  const g = PRICES.growth;
  const e = PRICES.enterprise;
  if (locale === "pt") {
    return [
      {
        q: "O que é a taxa de implantação?",
        a: `É uma cobrança única que cobre a preparação do seu restaurante: diagnóstico, configuração da conta, unidades, cardápio, estoque e equipe, treinamento remoto e validação antes de entrar em operação. É cobrada uma única vez, separada da assinatura mensal: ${usd(s.implementationUsd)} no Starter, ${usd(g.implementationUsd)} no Growth e a partir de ${usd(e.implementationFromUsd)} no Enterprise, conforme o escopo.`,
      },
      {
        q: "O que a assinatura mensal inclui?",
        a: `A assinatura dá à sua equipe acesso ao Dinequora com os recursos do seu plano: ${usd(s.monthlyUsd)} por mês no Starter e ${usd(g.monthlyUsd)} por mês no Growth. No Enterprise, o valor é definido em contrato conforme o número de unidades e o escopo do projeto.`,
      },
      {
        q: "Como funcionam várias unidades?",
        a: "Cada plano inclui um número de unidades: 1 no Starter, até 3 no Growth e até 50 no Enterprise, conforme contrato. Só as unidades ativas contam para o plano. Se você crescer além do seu plano, ajudamos na mudança para o próximo.",
      },
      {
        q: "Existem outras taxas?",
        a: "Não. Os preços publicados são a taxa de implantação e a assinatura mensal. O Enterprise é orçado individualmente e acordado por escrito antes de qualquer trabalho começar. Todos os preços são em dólares americanos (US$).",
      },
      {
        q: "O Dinequora processa pagamentos com cartão?",
        a: "Hoje, não. O PDV registra cada venda e a forma de pagamento (dinheiro, cartão ou carteira digital), mas o Dinequora não processa pagamentos com cartão nem se conecta a maquininhas. Continue usando a sua processadora de pagamentos atual.",
      },
      {
        q: "Preciso de algum equipamento especial?",
        a: "Não. O Dinequora funciona em um navegador moderno, nos computadores e tablets que você já tem. Não vendemos nem instalamos equipamentos.",
      },
      {
        q: "Quanto tempo leva a implantação?",
        a: "Depende do tamanho do cardápio, do estoque e do número de unidades. Combinamos um prazo com você na etapa de diagnóstico, antes de configurar qualquer coisa.",
      },
      {
        q: "O sistema está em português?",
        a: "Este site está em inglês e português. A interface do aplicativo Dinequora hoje é em inglês, pois o produto foi criado para o mercado dos Estados Unidos. Nesta versão do site, as telas do produto aparecem traduzidas para o português apenas para ilustrar.",
      },
      {
        q: "Os recursos de IA estão incluídos no meu plano?",
        a: "Ainda não. Os recursos de IA desta página estão em desenvolvimento e não fazem parte de nenhum plano atual. Vamos anunciar a disponibilidade e eventuais preços antes do lançamento.",
      },
    ];
  }
  return [
    {
      q: "What is the implementation fee?",
      a: `It is a one-time charge that covers getting your restaurant set up: discovery, configuration of your account, locations, menu, inventory and team, remote training, and go-live validation. It is billed once, separately from the monthly subscription: ${usd(s.implementationUsd)} for Starter, ${usd(g.implementationUsd)} for Growth, and from ${usd(e.implementationFromUsd)} for Enterprise depending on scope.`,
    },
    {
      q: "What does the monthly subscription include?",
      a: `Your subscription gives your team access to Dinequora with the capabilities of your plan: ${usd(s.monthlyUsd)} per month for Starter and ${usd(g.monthlyUsd)} per month for Growth. Enterprise subscriptions are priced by contract based on the number of locations and the scope of the engagement.`,
    },
    {
      q: "How are multiple locations handled?",
      a: "Each plan includes a set number of restaurant locations: 1 on Starter, up to 3 on Growth, and up to 50 on Enterprise, subject to contract. Only active locations count toward your plan. If you outgrow your plan, we will help you move to the next one.",
    },
    {
      q: "Are there any other fees?",
      a: "No. The published prices are the implementation fee and the monthly subscription. Enterprise is quoted individually and agreed in writing before any work begins. All prices are in US dollars.",
    },
    {
      q: "Does Dinequora process card payments?",
      a: "Not today. The point of sale records each sale and its payment method (cash, card, or digital wallet), but Dinequora does not process card payments or connect to payment terminals. Keep your existing payment processor.",
    },
    {
      q: "Do I need special hardware?",
      a: "No. Dinequora runs in a modern web browser on the computers and tablets you already have. We do not sell or install hardware.",
    },
    {
      q: "How long does implementation take?",
      a: "It depends on the size of your menu, your inventory, and the number of locations. We agree on a timeline with you during discovery, before anything is configured.",
    },
    {
      q: "Are the AI features included in my plan?",
      a: "Not yet. The AI capabilities on this page are in development and are not part of any current plan. We will announce availability and any pricing before they launch.",
    },
  ];
}
