/**
 * Feature catalog, in English and Portuguese. Each capability carries an
 * availability status that was verified against the Dinequora application
 * codebase (see README → "Feature verification"). The status is defined once
 * per capability, so both languages always agree. Update it when a capability ships.
 *
 *  - "available":   built and persisted in the product today.
 *  - "rollingOut":  partially built — usable, but not yet complete.
 */
import type { LucideIcon } from "lucide-react";
import { BarChart3, ChefHat, Landmark, Package, Users } from "lucide-react";
import { pick, type Locale } from "../i18n/locale";

export type FeatureStatus = "available" | "rollingOut";

export type Capability = {
  name: string;
  detail: string;
  status: FeatureStatus;
};

export type FeatureCategory = {
  id: string;
  title: string;
  kicker: string;
  summary: string;
  icon: LucideIcon;
  /** `position` is the CSS object-position that keeps the subject in the wide banner crop. */
  image: { src: string; alt: string; position: string };
  capabilities: readonly Capability[];
};

export function getFeatureCategories(locale: Locale): readonly FeatureCategory[] {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const cap = (status: FeatureStatus, name: [string, string], detail: [string, string]): Capability => ({
    status,
    name: t(...name),
    detail: t(...detail),
  });
  return [
    {
      id: "operations",
      title: t("Restaurant Operations", "Operação do restaurante"),
      kicker: t("Front of house to the pass", "Do salão ao passe"),
      summary: t(
        "Ring up tickets, send them straight to the kitchen, and keep the menu accurate at every location.",
        "Lance os pedidos, envie direto para a cozinha e mantenha o cardápio certo em todas as unidades.",
      ),
      icon: ChefHat,
      image: {
        src: "/images/chef-plating.webp",
        alt: t("Chef finishing a plate at the pass", "Chef finalizando um prato no passe"),
        position: "50% 68%",
      },
      capabilities: [
        cap(
          "available",
          ["Point of Sale (POS)", "Ponto de venda (PDV)"],
          [
            "Dine-in, takeout, and delivery tickets with discounts, held tickets, and server-calculated prices. Records the payment method; card processing is not built in.",
            "Pedidos para consumo no local, retirada e entrega, com descontos, pedidos em espera e preços calculados no servidor. Registra a forma de pagamento; não processa cartões.",
          ],
        ),
        cap(
          "available",
          ["Kitchen Display System (KDS)", "Tela da cozinha (KDS)"],
          [
            "New, in preparation, ready, and completed columns, station filters, ticket timers, and item-level ready marks.",
            "Colunas de novos, em preparo, prontos e concluídos, filtros por estação, cronômetro por pedido e marcação de pronto por item.",
          ],
        ),
        cap(
          "available",
          ["Real-time order workflow", "Fluxo de pedidos em tempo real"],
          [
            "Tickets move from the POS to the kitchen queue automatically, with live updates and a periodic refresh as a fallback.",
            "Os pedidos vão do PDV para a fila da cozinha automaticamente, com atualização ao vivo e atualização periódica como reserva.",
          ],
        ),
        cap(
          "available",
          ["Menu management", "Gestão de cardápio"],
          [
            "Categories, modifiers, per-location availability, duplication, and archiving.",
            "Categorias, complementos, disponibilidade por unidade, duplicação e arquivamento.",
          ],
        ),
        cap(
          "rollingOut",
          ["Order management", "Gestão de pedidos"],
          [
            "Orders flow and change status through the kitchen display today. A dedicated order history view is in development.",
            "Hoje os pedidos circulam e mudam de status pela tela da cozinha. Uma tela própria de histórico de pedidos está em desenvolvimento.",
          ],
        ),
      ],
    },
    {
      id: "inventory",
      title: t("Inventory & Purchasing", "Estoque e compras"),
      kicker: t("From supplier to shelf", "Do fornecedor à prateleira"),
      summary: t(
        "Know what is on hand, what moved, and what is on order, with low-stock and out-of-stock flags on every item.",
        "Saiba o que tem em estoque, o que foi movimentado e o que está pedido, com alertas de estoque baixo e zerado em cada item.",
      ),
      icon: Package,
      image: {
        src: "/images/kitchen-line.webp",
        alt: t("Kitchen team working an open line", "Equipe de cozinha trabalhando na linha"),
        position: "50% 60%",
      },
      capabilities: [
        cap(
          "available",
          ["Inventory tracking", "Controle de estoque"],
          [
            "Items with SKU, supplier, quantity, and minimum levels, with normal, low, and out-of-stock status.",
            "Itens com código (SKU), fornecedor, quantidade e estoque mínimo, com status normal, baixo ou zerado.",
          ],
        ),
        cap(
          "available",
          ["Stock movements", "Movimentações de estoque"],
          [
            "Record stock in, out, losses, adjustments, and transfers, each with a reason and the responsible person.",
            "Registre entradas, saídas, perdas, ajustes e transferências, cada uma com motivo e responsável.",
          ],
        ),
        cap(
          "available",
          ["Supplier management", "Gestão de fornecedores"],
          ["Maintain your supplier list and activate or deactivate vendors.", "Mantenha sua lista de fornecedores e ative ou desative cada um."],
        ),
        cap(
          "available",
          ["Purchase orders", "Pedidos de compra"],
          [
            "Create purchase orders and track them from draft to sent and received.",
            "Crie pedidos de compra e acompanhe do rascunho ao envio e ao recebimento.",
          ],
        ),
        cap(
          "available",
          ["Receiving management", "Recebimento de mercadorias"],
          [
            "Receive deliveries in full or in part against the original purchase order.",
            "Receba entregas totais ou parciais conferindo com o pedido de compra original.",
          ],
        ),
        cap(
          "rollingOut",
          ["Recipe management", "Fichas técnicas"],
          [
            "Store recipes and their ingredients. Automatic per-serving costing is in development.",
            "Cadastre receitas e seus ingredientes. O custo automático por porção está em desenvolvimento.",
          ],
        ),
        cap(
          "rollingOut",
          ["Food cost control", "Controle de custo de alimentos (CMV)"],
          [
            "Ingredient cost is recorded against sales; detailed per-item food cost reporting is in development.",
            "O custo dos ingredientes é registrado junto às vendas; relatórios detalhados de custo por item estão em desenvolvimento.",
          ],
        ),
      ],
    },
    {
      id: "finance",
      title: t("Financial Management", "Gestão financeira"),
      kicker: t("The numbers behind service", "Os números por trás do serviço"),
      summary: t(
        "Track every expense, see revenue as it is recorded, and export the reports your accountant asks for.",
        "Acompanhe cada despesa, veja o faturamento conforme é registrado e exporte os relatórios que seu contador pede.",
      ),
      icon: Landmark,
      image: {
        src: "/images/manager-tablet.webp",
        alt: t("Restaurant manager holding a notepad in the dining room", "Gerente de restaurante com um bloco de notas no salão"),
        position: "50% 28%",
      },
      capabilities: [
        cap(
          "available",
          ["Expense tracking", "Controle de despesas"],
          [
            "Categorized expenses (suppliers, rent, payroll, utilities, and more) with due dates, recurrence, and pending, paid, or overdue status.",
            "Despesas por categoria (fornecedores, aluguel, folha, contas de consumo e outras) com vencimento, recorrência e status pendente, pago ou vencido.",
          ],
        ),
        cap(
          "available",
          ["Financial reports", "Relatórios financeiros"],
          [
            "Seven report types, including cash flow, revenue and sales, operating expenses, accounts payable, and multi-store performance. Export to CSV, an Excel-compatible spreadsheet, or print to PDF.",
            "Sete tipos de relatório, incluindo fluxo de caixa, faturamento e vendas, despesas operacionais, contas a pagar e desempenho por unidade. Exporte em CSV, planilha compatível com Excel ou imprima em PDF.",
          ],
        ),
        cap(
          "available",
          ["Revenue monitoring", "Acompanhamento do faturamento"],
          [
            "Revenue recorded from every completed sale, broken down by location.",
            "Faturamento registrado a cada venda concluída, separado por unidade.",
          ],
        ),
        cap(
          "rollingOut",
          ["Financial dashboard", "Painel financeiro"],
          [
            "Net profit estimate, operating expenses, payables, and settled amounts at a glance. Trend charts are being expanded.",
            "Estimativa de lucro líquido, despesas operacionais, contas a pagar e valores quitados em uma só tela. Os gráficos de tendência estão sendo ampliados.",
          ],
        ),
        cap(
          "rollingOut",
          ["Cost of goods sold", "Custo da mercadoria vendida (CMV)"],
          [
            "COGS entries are recorded at the time of sale; full COGS reporting depends on recipe costing.",
            "Os lançamentos de CMV são registrados no momento da venda; o relatório completo depende do custeio das fichas técnicas.",
          ],
        ),
        cap(
          "rollingOut",
          ["Cash flow projections", "Projeções de fluxo de caixa"],
          [
            "Historical daily, weekly, and monthly cash flow statements today. Forward-looking projections are in development.",
            "Hoje há demonstrativos de fluxo de caixa diários, semanais e mensais do histórico. As projeções futuras estão em desenvolvimento.",
          ],
        ),
      ],
    },
    {
      id: "team",
      title: t("Team Management", "Gestão da equipe"),
      kicker: t("The right access for every role", "O acesso certo para cada função"),
      summary: t(
        "Invite your team, give each person the right role, and limit managers and staff to the locations they work in.",
        "Convide sua equipe, dê a cada pessoa a função certa e limite gerentes e funcionários às unidades onde trabalham.",
      ),
      icon: Users,
      image: {
        src: "/images/service-tablet.webp",
        alt: t("Server taking an order at a table with a tablet", "Garçom anotando um pedido na mesa com um tablet"),
        position: "60% 58%",
      },
      capabilities: [
        cap(
          "available",
          ["Employee accounts", "Contas da equipe"],
          [
            "Invite team members with a secure invitation link and manage them in one place.",
            "Convide a equipe por um link de convite seguro e gerencie todos em um só lugar.",
          ],
        ),
        cap(
          "available",
          ["Role-based permissions", "Permissões por função"],
          [
            "Owner, manager, and staff roles. Staff never see financial data.",
            "Funções de dono, gerente e funcionário. Funcionários nunca veem dados financeiros.",
          ],
        ),
        cap(
          "available",
          ["Location-specific access", "Acesso por unidade"],
          [
            "Managers and staff see only the locations they are assigned to. Owners see everything.",
            "Gerentes e funcionários veem só as unidades às quais foram atribuídos. Donos veem tudo.",
          ],
        ),
        cap(
          "available",
          ["Team management", "Gestão de acessos"],
          [
            "Change roles and locations or remove access in seconds.",
            "Altere funções e unidades ou remova acessos em segundos.",
          ],
        ),
        cap(
          "available",
          ["Activity tracking", "Registro de atividades"],
          [
            "Owners and managers can review recent sensitive changes such as role, access, and membership updates.",
            "Donos e gerentes podem revisar alterações sensíveis recentes, como mudanças de função, acesso e participação na equipe.",
          ],
        ),
      ],
    },
    {
      id: "intelligence",
      title: t("Business Intelligence", "Inteligência de negócio"),
      kicker: t("See the whole operation", "Veja a operação inteira"),
      summary: t(
        "Compare locations, follow revenue and expenses, and turn daily activity into decisions.",
        "Compare unidades, acompanhe faturamento e despesas e transforme o dia a dia em decisões.",
      ),
      icon: BarChart3,
      image: {
        src: "/images/interior-moody.webp",
        alt: t("Warmly lit restaurant dining room", "Salão de restaurante com iluminação aconchegante"),
        position: "50% 62%",
      },
      capabilities: [
        cap(
          "available",
          ["Multi-location analytics", "Análise entre unidades"],
          [
            "Compare orders and expenses across your locations side by side.",
            "Compare pedidos e despesas das suas unidades lado a lado.",
          ],
        ),
        cap(
          "rollingOut",
          ["Performance dashboard", "Painel de desempenho"],
          [
            "An executive overview with KPIs, revenue trends, and store comparison, being connected to live data.",
            "Uma visão executiva com indicadores, tendência de faturamento e comparação entre unidades, sendo conectada aos dados reais.",
          ],
        ),
        cap(
          "rollingOut",
          ["Sales reports", "Relatórios de vendas"],
          ["Sales and revenue reports by period and location.", "Relatórios de vendas e faturamento por período e unidade."],
        ),
        cap(
          "rollingOut",
          ["Product performance", "Desempenho dos produtos"],
          ["Top menu items and product margins.", "Itens mais vendidos do cardápio e margem por produto."],
        ),
        cap(
          "rollingOut",
          ["Operational insights", "Alertas operacionais"],
          [
            "Alerts for low ingredients, delayed orders, and unusual sales drops.",
            "Alertas de ingredientes acabando, pedidos atrasados e quedas incomuns nas vendas.",
          ],
        ),
      ],
    },
  ];
}

/** English catalog (default language). */
export const featureCategories = getFeatureCategories("en");

export const statusLabels: Record<Locale, Record<FeatureStatus, string>> = {
  en: { available: "Available", rollingOut: "Rolling out" },
  pt: { available: "Disponível", rollingOut: "Parcial" },
};
