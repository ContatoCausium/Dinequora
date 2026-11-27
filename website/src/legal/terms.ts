/**
 * Terms of use of the site and of a Dinequora subscription, in English (the governing text) and
 * Portuguese.
 *
 * Cancellation, refund and governing-law rules are the ones the owner approved on 2026-11-17.
 * Amounts and discounts are read from config/pricing.ts, the same source as the Pricing section,
 * so the two can never disagree. Rules the owner has not decided yet (renewal and price changes,
 * the limit of liability) are shown as visible "[preencher: …]" markers, never invented.
 */
import { BILLING, formatUsd, PRICES } from "../config/pricing";
import { WHATSAPP, whatsappUrl } from "../config/site";
import { pagePath, type Locale } from "../i18n/meta";
import type { LegalDocument } from "./types";

const whatsapp = { href: whatsappUrl(), label: WHATSAPP.display, external: true };
const pct = (discount: number) => `${Math.round(discount * 100)}%`;

/** Business rules still to be decided by the owner (also listed in the PR). */
export const PENDING_RULES = {
  renewal: "regra de renovação da assinatura e de reajuste de preço",
  liability: "limite de responsabilidade da Dinequora",
} as const;

function buildTerms(locale: Locale): LegalDocument {
  const usd = (amount: number) => formatUsd(amount, locale);
  const s = PRICES.starter;
  const g = PRICES.growth;
  const e = PRICES.enterprise;
  const semi = pct(BILLING.semiannual.discount);
  const year = pct(BILLING.annual.discount);

  if (locale === "en") {
    return {
      title: "Terms of Use",
      lead: "The rules for using the Dinequora website and for subscribing to Dinequora.",
      sections: [
        {
          id: "agreement",
          heading: "Agreement",
          blocks: [
            {
              p: [
                "These Terms of Use (the “Terms”) govern your use of dinequora.com and www.dinequora.com (the “site”) and your subscription to Dinequora, the restaurant management software offered by ",
                { fact: "legalName" },
                " (“Dinequora”, “we”, “us”), a company organized in ",
                { fact: "stateOfOrganization" },
                ". By using the site or subscribing, you agree to these Terms. If you subscribe for a business, you confirm that you can bind it.",
              ],
            },
            {
              p: [
                "If you sign a separate written agreement with us (for example for Enterprise), that agreement prevails where it differs from these Terms. Our ",
                { href: pagePath("privacy", "en"), label: "Privacy Policy" },
                " explains how we handle personal information.",
              ],
            },
          ],
        },
        {
          id: "service",
          heading: "The service",
          blocks: [
            {
              p: [
                "Dinequora is restaurant management software: point of sale, kitchen display, menu, inventory, purchasing, finance, team and multi-location management. Features the site labels as rolling out, coming soon or on the AI roadmap are not available yet, and they are not part of what you pay for until we release them.",
              ],
            },
            { p: ["The product images on the site show illustrative sample data, not real results."] },
          ],
        },
        {
          id: "plans",
          heading: "Plans and prices",
          blocks: [
            { p: ["Each plan has two separate charges: a one-time implementation fee and a recurring subscription. Prices are in US dollars."] },
            {
              ul: [
                [{ strong: "Starter:" }, ` ${usd(s.monthlyUsd)} per month, plus a ${usd(s.implementationUsd)} implementation fee. 1 restaurant location.`],
                [{ strong: "Growth:" }, ` ${usd(g.monthlyUsd)} per month, plus a ${usd(g.implementationUsd)} implementation fee. Up to 3 restaurant locations.`],
                [
                  { strong: "Enterprise:" },
                  ` price set by contract, with an implementation fee from ${usd(e.implementationFromUsd)}. Up to 50 locations, subject to contract.`,
                ],
              ],
            },
          ],
        },
        {
          id: "billing",
          heading: "Billing periods",
          blocks: [
            { p: ["Starter and Growth subscriptions can be paid:"] },
            {
              ul: [
                ["monthly;"],
                [`every 6 months, paid upfront for the whole period, with ${semi} off the subscription;`],
                [`yearly, paid upfront for the whole period, with ${year} off the subscription.`],
              ],
            },
            { p: ["The implementation fee is charged once and is never discounted. Enterprise billing follows its contract."] },
            { p: ["Renewal and price changes: ", { pending: PENDING_RULES.renewal }, "."] },
          ],
        },
        {
          id: "cancellation",
          heading: "Cancellation and refunds",
          blocks: [
            {
              ul: [
                [
                  { strong: "Monthly plans (Starter, Growth)." },
                  " You can cancel at any time. Your access continues until the end of the month you paid for. We do not give prorated refunds.",
                ],
                [
                  { strong: "6-month and yearly plans." },
                  " These are prepaid with a discount, so there is no refund if you cancel in the middle of the period. Your access continues until the end of the period you paid for.",
                ],
                [
                  { strong: "Implementation fee." },
                  " It is non-refundable once implementation has started.",
                ],
                [{ strong: "Enterprise." }, " Cancellation and refunds follow its contract."],
              ],
            },
            {
              p: [
                "To cancel, email ",
                { fact: "contactEmail" },
                " or message us on WhatsApp at ",
                whatsapp,
                ".",
              ],
            },
          ],
        },
        {
          id: "your-account",
          heading: "Your account",
          blocks: [
            {
              p: [
                "You are responsible for keeping your login details safe, for the people you give access to, and for the information you enter. Tell us right away if you think someone used your account without permission.",
              ],
            },
          ],
        },
        {
          id: "acceptable-use",
          heading: "Acceptable use",
          blocks: [
            { p: ["You agree not to:"] },
            {
              ul: [
                ["use the site or the service for anything unlawful;"],
                ["try to break, overload or get around the security of the site or the service;"],
                ["copy, resell or reverse engineer the service, except where the law allows it."],
              ],
            },
          ],
        },
        {
          id: "intellectual-property",
          heading: "Intellectual property",
          blocks: [
            {
              p: [
                "The Dinequora name, logo, software and site content belong to us or to our licensors. These Terms do not transfer them to you. Photographs on the site are used under the Unsplash license.",
              ],
            },
          ],
        },
        {
          id: "liability",
          heading: "Disclaimers and limitation of liability",
          blocks: [
            {
              p: [
                "The site is provided for general information. We work to keep it accurate, but it may contain errors and may change without notice.",
              ],
            },
            { p: ["Limitation of liability: ", { pending: PENDING_RULES.liability }, "."] },
          ],
        },
        {
          id: "governing-law",
          heading: "Governing law and venue",
          blocks: [
            {
              p: [
                "These Terms are governed by the laws of the Commonwealth of Massachusetts, United States. Any dispute about them will be handled by the state or federal courts located in Massachusetts.",
              ],
            },
          ],
        },
        {
          id: "changes",
          heading: "Changes to these Terms",
          blocks: [{ p: ["If we change these Terms, we will post the new version on this page with a new effective date."] }],
        },
        {
          id: "contact",
          heading: "Contact us",
          blocks: [
            {
              ul: [
                ["Company: ", { fact: "legalName" }],
                ["Email: ", { fact: "contactEmail" }],
                ["Mail: ", { fact: "mailingAddress" }],
                ["WhatsApp: ", whatsapp],
              ],
            },
          ],
        },
      ],
    };
  }

  return {
    title: "Termos de Uso",
    lead: "As regras para usar o site da Dinequora e para assinar a Dinequora.",
    sections: [
      {
        id: "agreement",
        heading: "Acordo",
        blocks: [
          {
            p: [
              "Estes Termos de Uso (os “Termos”) regem o uso de dinequora.com e www.dinequora.com (o “site”) e a sua assinatura da Dinequora, o software de gestão para restaurantes oferecido pela ",
              { fact: "legalName" },
              " (“Dinequora”, “nós”), empresa registrada no estado de ",
              { fact: "stateOfOrganization" },
              ", nos Estados Unidos. Ao usar o site ou assinar, você concorda com estes Termos. Se você assina por uma empresa, confirma que pode representá-la.",
            ],
          },
          {
            p: [
              "Se você assinar um contrato escrito separado conosco (por exemplo, no Enterprise), esse contrato prevalece no que for diferente destes Termos. A nossa ",
              { href: pagePath("privacy", "pt"), label: "Política de Privacidade" },
              " explica como tratamos informações pessoais.",
            ],
          },
        ],
      },
      {
        id: "service",
        heading: "O serviço",
        blocks: [
          {
            p: [
              "A Dinequora é um software de gestão para restaurantes: ponto de venda, tela da cozinha, cardápio, estoque, compras, financeiro, equipe e gestão de várias unidades. Os recursos que o site marca como em implantação, em breve ou no plano de IA ainda não estão disponíveis e não fazem parte do que você paga até serem lançados.",
            ],
          },
          { p: ["As imagens do produto no site mostram dados ilustrativos de exemplo, não resultados reais."] },
        ],
      },
      {
        id: "plans",
        heading: "Planos e preços",
        blocks: [
          { p: ["Cada plano tem duas cobranças separadas: uma taxa única de implantação e uma assinatura recorrente. Os preços são em dólares americanos."] },
          {
            ul: [
              [{ strong: "Starter:" }, ` ${usd(s.monthlyUsd)} por mês, mais taxa de implantação de ${usd(s.implementationUsd)}. 1 unidade.`],
              [{ strong: "Growth:" }, ` ${usd(g.monthlyUsd)} por mês, mais taxa de implantação de ${usd(g.implementationUsd)}. Até 3 unidades.`],
              [
                { strong: "Enterprise:" },
                ` preço definido em contrato, com taxa de implantação a partir de ${usd(e.implementationFromUsd)}. Até 50 unidades, conforme contrato.`,
              ],
            ],
          },
        ],
      },
      {
        id: "billing",
        heading: "Períodos de cobrança",
        blocks: [
          { p: ["As assinaturas Starter e Growth podem ser pagas:"] },
          {
            ul: [
              ["por mês;"],
              [`a cada 6 meses, pagos à vista pelo período inteiro, com ${semi} de desconto na assinatura;`],
              [`por ano, pago à vista pelo período inteiro, com ${year} de desconto na assinatura.`],
            ],
          },
          { p: ["A taxa de implantação é cobrada uma única vez e nunca tem desconto. A cobrança do Enterprise segue o contrato."] },
          { p: ["Renovação e reajuste de preço: ", { pending: PENDING_RULES.renewal }, "."] },
        ],
      },
      {
        id: "cancellation",
        heading: "Cancelamento e reembolso",
        blocks: [
          {
            ul: [
              [
                { strong: "Planos mensais (Starter, Growth)." },
                " Você pode cancelar quando quiser. O acesso continua até o fim do mês já pago. Não fazemos reembolso proporcional.",
              ],
              [
                { strong: "Planos semestrais e anuais." },
                " São pré-pagos com desconto, por isso não há reembolso se você cancelar no meio do período. O acesso continua até o fim do período já pago.",
              ],
              [{ strong: "Taxa de implantação." }, " Não é reembolsável depois que a implantação começa."],
              [{ strong: "Enterprise." }, " Cancelamento e reembolso seguem o contrato."],
            ],
          },
          {
            p: ["Para cancelar, escreva para ", { fact: "contactEmail" }, " ou fale conosco no WhatsApp pelo ", whatsapp, "."],
          },
        ],
      },
      {
        id: "your-account",
        heading: "Sua conta",
        blocks: [
          {
            p: [
              "Você é responsável por manter seus dados de acesso seguros, pelas pessoas a quem dá acesso e pelas informações que registra. Avise-nos imediatamente se achar que alguém usou a sua conta sem permissão.",
            ],
          },
        ],
      },
      {
        id: "acceptable-use",
        heading: "Uso aceitável",
        blocks: [
          { p: ["Você concorda em não:"] },
          {
            ul: [
              ["usar o site ou o serviço para nada ilegal;"],
              ["tentar quebrar, sobrecarregar ou contornar a segurança do site ou do serviço;"],
              ["copiar, revender ou fazer engenharia reversa do serviço, exceto quando a lei permitir."],
            ],
          },
        ],
      },
      {
        id: "intellectual-property",
        heading: "Propriedade intelectual",
        blocks: [
          {
            p: [
              "O nome, a logo, o software e o conteúdo do site da Dinequora pertencem a nós ou aos nossos licenciadores. Estes Termos não os transferem para você. As fotos do site são usadas sob a licença do Unsplash.",
            ],
          },
        ],
      },
      {
        id: "liability",
        heading: "Isenções e limite de responsabilidade",
        blocks: [
          {
            p: [
              "O site é oferecido para informação geral. Trabalhamos para mantê-lo correto, mas ele pode conter erros e mudar sem aviso.",
            ],
          },
          { p: ["Limite de responsabilidade: ", { pending: PENDING_RULES.liability }, "."] },
        ],
      },
      {
        id: "governing-law",
        heading: "Lei aplicável e foro",
        blocks: [
          {
            p: [
              "Estes Termos são regidos pelas leis do estado de Massachusetts (Commonwealth of Massachusetts), nos Estados Unidos. Qualquer disputa sobre eles será resolvida pelos tribunais estaduais ou federais localizados em Massachusetts.",
            ],
          },
        ],
      },
      {
        id: "changes",
        heading: "Mudanças nestes Termos",
        blocks: [{ p: ["Se mudarmos estes Termos, publicaremos a nova versão nesta página com uma nova data de vigência."] }],
      },
      {
        id: "contact",
        heading: "Fale conosco",
        blocks: [
          {
            ul: [
              ["Empresa: ", { fact: "legalName" }],
              ["E-mail: ", { fact: "contactEmail" }],
              ["Correio: ", { fact: "mailingAddress" }],
              ["WhatsApp: ", whatsapp],
            ],
          },
          { p: ["Esta versão em português é uma tradução para a sua conveniência; se houver diferença, vale a versão em inglês."] },
        ],
      },
    ],
  };
}

export const termsOfUse: Record<Locale, LegalDocument> = { en: buildTerms("en"), pt: buildTerms("pt") };
