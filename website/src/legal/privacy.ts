/**
 * Privacy policy of the marketing site, in English (the governing text) and Portuguese.
 *
 * It describes what the site actually does today: the demo form hands the request to WhatsApp
 * (no form backend), Cloudflare hosts the site and counts visits with Web Analytics (no cookies),
 * the language choice stays in localStorage, and there is no Google Analytics or Meta Pixel.
 * If any of that changes (a form backend, a new tracker), this text must change with it.
 */
import { WHATSAPP, whatsappUrl } from "../config/site";
import type { Locale } from "../i18n/meta";
import type { LegalDocument } from "./types";

const whatsapp = { href: whatsappUrl(), label: WHATSAPP.display, external: true };
const cloudflarePolicy = "https://www.cloudflare.com/privacypolicy/";
const whatsappPolicy = "https://www.whatsapp.com/legal/privacy-policy";
const instagramPolicy = "https://privacycenter.instagram.com/policy";

const en: LegalDocument = {
  title: "Privacy Policy",
  lead: "What the Dinequora website collects, why, who we share it with, and the choices you have.",
  sections: [
    {
      id: "who-we-are",
      heading: "Who we are",
      blocks: [
        {
          p: [
            "This policy explains how ",
            { fact: "legalName" },
            " (“Dinequora”, “we”, “us”), a company organized in ",
            { fact: "stateOfOrganization" },
            ", handles personal information collected through dinequora.com and www.dinequora.com (the “site”).",
          ],
        },
        {
          p: [
            "It covers this site only. Information that restaurants enter into the Dinequora application is handled under their agreement with us for that service.",
          ],
        },
      ],
    },
    {
      id: "what-we-collect",
      heading: "What we collect",
      blocks: [
        {
          ul: [
            [
              { strong: "Demo requests." },
              " When you fill in the demo form, you give us your name, work email, restaurant or group name, number of locations and role, and optionally your phone and a message. The form does not send this to our servers: it opens WhatsApp with your request filled in, and nothing is sent until you tap send there.",
            ],
            [
              { strong: "WhatsApp conversations." },
              " When you message our sales line, we receive your phone number, your WhatsApp profile name and what you write.",
            ],
            [
              { strong: "Site analytics." },
              " We count visits with Cloudflare Web Analytics, which does not use cookies or fingerprinting. It records the pages viewed, the page you came from, your browser and device type and an approximate country, and shows them to us in aggregate.",
            ],
            [
              { strong: "Technical data." },
              " Like any website, our host (Cloudflare) receives your IP address and basic request data to deliver the pages and protect the site against abuse.",
            ],
            [
              { strong: "Your language choice." },
              " The site remembers whether you chose English or Portuguese in your browser’s local storage. It never leaves your device.",
            ],
          ],
        },
        {
          p: [
            "We do not set advertising cookies, and this site does not use Google Analytics, the Meta Pixel or other advertising trackers.",
          ],
        },
      ],
    },
    {
      id: "how-we-use-it",
      heading: "How we use it",
      blocks: [
        {
          ul: [
            ["To answer your demo request, schedule and run the demo, and talk with you about Dinequora."],
            ["To run, secure and improve the site."],
            ["To keep records the law requires and to protect our rights."],
          ],
        },
        {
          p: [
            "We do not sell your personal information, and we do not share it for cross-context behavioral advertising.",
          ],
        },
      ],
    },
    {
      id: "sharing",
      heading: "Who we share it with",
      blocks: [
        { p: ["We share personal information only with the providers that run the site and our sales channel, and only as needed:"] },
        {
          ul: [
            [
              "Cloudflare, which hosts the site and provides its analytics and security (",
              { href: cloudflarePolicy, label: "Cloudflare’s privacy policy", external: true },
              ").",
            ],
            [
              "WhatsApp (Meta), when you contact us there. Your messages are also handled under ",
              { href: whatsappPolicy, label: "WhatsApp’s privacy policy", external: true },
              ".",
            ],
            [
              "Instagram (Meta), only if you follow the link to our profile, under ",
              { href: instagramPolicy, label: "Instagram’s privacy policy", external: true },
              ".",
            ],
          ],
        },
        {
          p: [
            "We may also disclose information when the law requires it, to protect our rights or the safety of others, or as part of a merger or sale of the business, in which case this policy keeps applying to it.",
          ],
        },
      ],
    },
    {
      id: "retention",
      heading: "How long we keep it",
      blocks: [
        {
          p: [
            "We keep demo requests and sales conversations while we are talking with you about Dinequora and for as long as needed to follow up, and then delete them, unless you become a customer or the law requires us to keep them longer. Cloudflare keeps analytics and request data under its own retention rules.",
          ],
        },
      ],
    },
    {
      id: "your-rights",
      heading: "Your rights and choices",
      blocks: [
        { p: ["Depending on the state where you live (for example California, under the CCPA as amended by the CPRA), you may have the right to:"] },
        {
          ul: [
            ["know what personal information we hold about you and get a copy of it;"],
            ["correct it;"],
            ["delete it;"],
            ["opt out of its sale or sharing (we do neither);"],
            ["not be treated differently for using these rights."],
          ],
        },
        {
          p: [
            "To make a request, email ",
            { fact: "contactEmail" },
            " or message us on WhatsApp at ",
            whatsapp,
            ". We may ask for information to confirm that the request comes from you, and we answer within 45 days. You can also make a request through an authorized agent. If we decline a request, you can appeal by replying to our answer.",
          ],
        },
        { p: ["If we send you marketing emails, each one has a link to stop them, and you can ask us to stop at any time."] },
      ],
    },
    {
      id: "children",
      heading: "Children",
      blocks: [
        {
          p: [
            "This site is for restaurant businesses. It is not directed to children under 13, and we do not knowingly collect their information. If you believe a child has sent us information, contact us and we will delete it.",
          ],
        },
      ],
    },
    {
      id: "security",
      heading: "Security",
      blocks: [
        {
          p: [
            "The site is served only over HTTPS, with strict security headers. No method of transmission or storage is completely secure, so we cannot guarantee absolute security.",
          ],
        },
      ],
    },
    {
      id: "where",
      heading: "Where your information is processed",
      blocks: [
        {
          p: [
            "We are based in the United States. Our providers may process information in the United States and in other countries, under their own safeguards.",
          ],
        },
      ],
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      blocks: [{ p: ["If we change this policy, we will post the new version on this page with a new effective date."] }],
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

const pt: LegalDocument = {
  title: "Política de Privacidade",
  lead: "O que o site da Dinequora coleta, para quê, com quem compartilhamos e as escolhas que você tem.",
  sections: [
    {
      id: "who-we-are",
      heading: "Quem somos",
      blocks: [
        {
          p: [
            "Esta política explica como a ",
            { fact: "legalName" },
            " (“Dinequora”, “nós”), empresa registrada no estado de ",
            { fact: "stateOfOrganization" },
            ", nos Estados Unidos, trata as informações pessoais coletadas em dinequora.com e www.dinequora.com (o “site”).",
          ],
        },
        {
          p: [
            "Ela vale só para este site. As informações que os restaurantes registram no aplicativo da Dinequora são tratadas conforme o contrato deles conosco para esse serviço.",
          ],
        },
      ],
    },
    {
      id: "what-we-collect",
      heading: "O que coletamos",
      blocks: [
        {
          ul: [
            [
              { strong: "Pedidos de demonstração." },
              " Ao preencher o formulário de demonstração, você nos informa nome, e-mail profissional, nome do restaurante ou grupo, número de unidades e função e, se quiser, telefone e uma mensagem. O formulário não envia esses dados aos nossos servidores: ele abre o WhatsApp com a sua solicitação preenchida, e nada é enviado até você tocar em enviar lá.",
            ],
            [
              { strong: "Conversas no WhatsApp." },
              " Quando você escreve para o nosso comercial, recebemos o seu número, o nome do seu perfil no WhatsApp e o que você escreve.",
            ],
            [
              { strong: "Estatísticas do site." },
              " Contamos as visitas com o Cloudflare Web Analytics, que não usa cookies nem identificação do aparelho. Ele registra as páginas vistas, a página de onde você veio, o tipo de navegador e de aparelho e o país aproximado, e nos mostra esses dados de forma agregada.",
            ],
            [
              { strong: "Dados técnicos." },
              " Como em qualquer site, a nossa hospedagem (Cloudflare) recebe o seu endereço IP e dados básicos da requisição para entregar as páginas e proteger o site contra abusos.",
            ],
            [
              { strong: "Sua escolha de idioma." },
              " O site lembra se você escolheu inglês ou português no armazenamento local do seu navegador. Essa informação não sai do seu aparelho.",
            ],
          ],
        },
        {
          p: [
            "Não usamos cookies de publicidade, e este site não usa Google Analytics, Pixel da Meta nem outros rastreadores de anúncios.",
          ],
        },
      ],
    },
    {
      id: "how-we-use-it",
      heading: "Como usamos",
      blocks: [
        {
          ul: [
            ["Para responder ao seu pedido de demonstração, agendar e fazer a demonstração e conversar com você sobre a Dinequora."],
            ["Para manter, proteger e melhorar o site."],
            ["Para guardar os registros exigidos por lei e proteger os nossos direitos."],
          ],
        },
        {
          p: [
            "Não vendemos as suas informações pessoais e não as compartilhamos para publicidade comportamental entre sites.",
          ],
        },
      ],
    },
    {
      id: "sharing",
      heading: "Com quem compartilhamos",
      blocks: [
        { p: ["Compartilhamos informações pessoais só com os fornecedores que fazem o site e o nosso canal comercial funcionarem, e só no que for preciso:"] },
        {
          ul: [
            [
              "Cloudflare, que hospeda o site e fornece as estatísticas e a segurança (",
              { href: cloudflarePolicy, label: "política de privacidade da Cloudflare", external: true },
              ").",
            ],
            [
              "WhatsApp (Meta), quando você fala conosco por lá. As suas mensagens também seguem a ",
              { href: whatsappPolicy, label: "política de privacidade do WhatsApp", external: true },
              ".",
            ],
            [
              "Instagram (Meta), só se você abrir o link do nosso perfil, conforme a ",
              { href: instagramPolicy, label: "política de privacidade do Instagram", external: true },
              ".",
            ],
          ],
        },
        {
          p: [
            "Também podemos divulgar informações quando a lei exigir, para proteger os nossos direitos ou a segurança de outras pessoas, ou numa fusão ou venda da empresa, caso em que esta política continua valendo para elas.",
          ],
        },
      ],
    },
    {
      id: "retention",
      heading: "Por quanto tempo guardamos",
      blocks: [
        {
          p: [
            "Guardamos os pedidos de demonstração e as conversas comerciais enquanto estivermos conversando com você sobre a Dinequora e pelo tempo necessário para o acompanhamento, e depois os apagamos, a menos que você se torne cliente ou a lei exija guardá-los por mais tempo. A Cloudflare guarda as estatísticas e os dados das requisições conforme as regras dela.",
          ],
        },
      ],
    },
    {
      id: "your-rights",
      heading: "Seus direitos e escolhas",
      blocks: [
        { p: ["Dependendo do estado onde você mora (por exemplo, na Califórnia, pela CCPA com as mudanças da CPRA), você pode ter o direito de:"] },
        {
          ul: [
            ["saber quais informações pessoais temos sobre você e receber uma cópia;"],
            ["corrigi-las;"],
            ["apagá-las;"],
            ["recusar a venda ou o compartilhamento delas (não fazemos nenhum dos dois);"],
            ["não ser tratado de forma diferente por usar esses direitos."],
          ],
        },
        {
          p: [
            "Para fazer um pedido, escreva para ",
            { fact: "contactEmail" },
            " ou fale conosco no WhatsApp pelo ",
            whatsapp,
            ". Podemos pedir informações para confirmar que o pedido é seu, e respondemos em até 45 dias. Você também pode fazer o pedido por meio de um representante autorizado. Se recusarmos um pedido, você pode recorrer respondendo à nossa resposta.",
          ],
        },
        { p: ["Se enviarmos e-mails de marketing, cada um terá um link para pará-los, e você pode nos pedir para parar a qualquer momento."] },
      ],
    },
    {
      id: "children",
      heading: "Crianças",
      blocks: [
        {
          p: [
            "Este site é para restaurantes. Ele não é voltado a menores de 13 anos, e não coletamos informações deles de propósito. Se você acredita que uma criança nos enviou informações, fale conosco e nós as apagaremos.",
          ],
        },
      ],
    },
    {
      id: "security",
      heading: "Segurança",
      blocks: [
        {
          p: [
            "O site é entregue só por HTTPS, com cabeçalhos de segurança rígidos. Nenhum meio de transmissão ou armazenamento é totalmente seguro, por isso não podemos garantir segurança absoluta.",
          ],
        },
      ],
    },
    {
      id: "where",
      heading: "Onde as informações são tratadas",
      blocks: [
        {
          p: [
            "Estamos nos Estados Unidos. Os nossos fornecedores podem tratar informações nos Estados Unidos e em outros países, com as proteções deles.",
          ],
        },
      ],
    },
    {
      id: "changes",
      heading: "Mudanças nesta política",
      blocks: [{ p: ["Se mudarmos esta política, publicaremos a nova versão nesta página com uma nova data de vigência."] }],
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

export const privacyPolicy: Record<Locale, LegalDocument> = { en, pt };
