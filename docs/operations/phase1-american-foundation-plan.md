# Fase 1 — American Foundation: auditoria e plano técnico

Status: **planejamento — nada implementado**. Nenhum código de produção, migration, banco, commit ou
push foi alterado para produzir este documento.

Base auditada: `main` em `96db434` (PR #1 integrado; CI `quality` + `security` verdes; Vitest 287/287;
matriz de permissões 144/144). O esquema foi lido no stack descartável de QA (21 migrations
aplicadas), somente leitura. Referências `arquivo:linha` apontam para esse commit. Migrations são
citadas pelo número (`0018:346` = `drizzle/migrations/0018_member_permissions.sql`, linha 346); a
definição válida de cada função é o último `CREATE OR REPLACE` do journal.

Objetivo da fase: transformar o Dinequora numa plataforma de gestão de restaurantes para o mercado
dos EUA — **multi-organização, multi-loja, reutilizável** — tendo o MARAO BURGERS como primeiro
piloto, sem nenhum código, dado ou regra específicos desse cliente.

---

## 1. Diagnóstico do estado atual

Critério: algo só conta como **pronto** se for persistido e imposto no servidor (RPC/RLS no banco
ou função de servidor). Tela, cálculo no navegador ou simulação contam como **parcial** ou
**inexistente**.

### 1.1 Visão geral

| Área                               | Situação                               | Resumo                                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Multi-tenant / multi-loja          | **Pronto, com 1 ponto a endurecer**    | Organização → lojas; membros com papel, perfil e acesso por loja; RLS e RPCs checam membro, permissão e loja                                                                               |
| Permissões e dashboards por função | **Pronto**                             | 42 permissões, 6 perfis de sistema, teto por papel, conjunto efetivo materializado; matriz 144/144                                                                                         |
| PDV e pedidos                      | **Parcial (núcleo sólido)**            | Venda atômica, preços e modificadores recalculados no servidor, idempotência, baixa de estoque, estorno total; **1 pagamento por pedido**, sem gorjeta, sem divisão, sem reembolso parcial |
| Impostos                           | **Inexistente como motor**             | O servidor calcula o valor, mas a **alíquota vem do navegador**, fixa em 8,88%                                                                                                             |
| Pagamentos                         | **Inexistente (só registro)**          | `cash/card/digital` são rótulos; nenhum processador; nenhum terminal                                                                                                                       |
| Caixa (cash management)            | **Inexistente**                        | Sem abertura/fechamento, turno, sangria, reforço ou conferência                                                                                                                            |
| Financeiro e despesas              | **Parcial**                            | Ledger `finance_entries` gravado pelo servidor; despesas em `jsonb`; **todos os totais calculados no navegador**, com limites de leitura                                                   |
| Estoque e CMV                      | **Parcial (bom no servidor)**          | Movimentos idempotentes, receitas com perda, CMV gravado na venda; custo = último custo; conversão de unidades diverge entre servidor e navegador                                          |
| Regionalização e idiomas           | **Parcial**                            | Idioma por usuário (en-US/pt-BR, paridade 2.272 chaves); moeda USD fixa no código; fuso por loja só parcialmente usado                                                                     |
| Integrações                        | **Inexistentes**                       | Stripe só como esqueleto de cobrança SaaS; WhatsApp, e-mail, IA, delivery, impressoras, terminais: simulação ou nada                                                                       |
| Testes e observabilidade           | **Pronto para a base atual**           | 39 arquivos Vitest, 3 fixtures SQL, matriz de permissões, CI com banco do zero; logs estruturados com redação                                                                              |
| Migrations                         | **Íntegro, com política a formalizar** | Journal 0000–0020 íntegro; órfãs bloqueadas; snapshots Drizzle vazios por desenho (seção 4)                                                                                                |

### 1.2 Multi-tenant e multi-loja

O que existe de verdade:

- Tabelas: `organizations`, `locations` (com `timezone` validado, `hours`, `status`),
  `organization_members` (papel `owner|manager|staff`, `profile_id`, permissões extras/revogadas e
  `effective_permissions` materializado), `member_location_access`, `permission_profiles` (sistema
  e por organização), `audit_logs`.
- Escopo de loja no banco: `can_access_location` (0003:20-28), `can_operate_location` (0003:143-148),
  `assert_operational_scope` (0018:167-178, confere que a loja pertence à organização).
- `has_permission(_org_id, _perm, _location_id)` (0019:66-73) — consulta indexada ao conjunto
  efetivo; `assert_permission` registra a negação em auditoria (0018:134-141).
- RLS de leitura combina membro, loja e permissão (0019:91-147). Custos de estoque ficam ocultos por
  privilégio de coluna e só saem por `inventory_item_costs()` / `inventory_movement_costs()` (0020).
- Organização ativa: `localStorage servora.org`; loja ativa: estado React, padrão “todas”
  (`src/components/app/workspace-context.tsx:80-93, 153-156, 202-203`).

Ponto a endurecer (antes de criar RPCs novas): `has_permission` com `_location_id` verifica acesso
à loja **mas não** que a loja pertence a `_org_id` (0019:66-73 + 0003:20-28). Um usuário membro de
duas organizações poderia combinar a permissão de uma com a loja da outra. Hoje as RPCs se protegem
porque também chamam `assert_operational_scope`; a correção é incluir `l.org_id = _org_id` na
própria função (subfase 1.0) e cobrir com um caso novo na matriz (usuário com duas organizações).

### 1.3 PDV e pedidos

Pronto no servidor (`create_pos_sale` 0018:318-349; `finalize_pos_sale_atomic` 0018:352-371,
chamado via `persist_finalized_pos_sale_atomic` 0013:77 e `src/lib/operational.functions.ts:177`):

- Preço base e modificadores recalculados a partir de `menu_products` (0018:338-344), com regras
  min/max/obrigatório dos grupos; produto precisa estar ativo e na loja.
- Idempotência por `client_order_id` + impressão digital SHA-256 + lock consultivo
  (0018:329-332; `UNIQUE(org_id, client_order_id)`).
- Baixa de estoque por receita com bloqueio de linha e falha atômica em `insufficient_stock`
  (0018:364-367); ledger `revenue` (total − imposto) e `cogs` (0018:368).
- Status `new → confirmed → in_prep → ready → delivered`, cancelamento com estorno de estoque,
  ledger e pagamento (0018:374-399); KDS em tempo real (`kds.tsx:149-174`, publicação 0017:23-42).
- Venda simulada só para organização demo (0018:326).

Lacunas:

- **Pagamento**: `payments.order_id UNIQUE` (0012:47) → um pagamento por pedido; valor sempre igual
  ao total (0018:369); valor entregue e troco só no navegador (`pos.tsx:321-327`).
- Sem gorjeta, divisão de conta, pagamento parcial, conta aberta (tab), cortesia, motivo de
  desconto, reembolso parcial ou por item, distinção entre _void_ (antes do pagamento) e
  _refund_ (depois).
- Desconto é um valor único em centavos, sem percentual, motivo ou aprovação (0018:346).
- O PDV real envia só o nome do cliente (`orders-persistence-service.ts:92-104`); telefone, e-mail
  e endereço existem na tabela mas não são usados pelo PDV.
- Vendas em espera ficam só no `localStorage` do aparelho (`pos-service.ts:86-177`).
- Recibo: `window.print()` do navegador (`pos.tsx:1070`). Sem modo offline.
- Estações do KDS são deduzidas pelo nome do produto (`kds-service.ts:30-66`).
- Código legado: `ORDERS_BACKEND_AVAILABLE = false` (`orders-backend.ts:12`); caminho antigo de
  venda simulada em `pos-service.ts:240-297`.

### 1.4 Impostos

- O servidor calcula `tax = round((subtotal − desconto) × bps / 10000)` (0018:346), arredondando
  meio para cima (_half away from zero_), sobre o pedido inteiro.
- **A alíquota vem do navegador**: `DEFAULT_POS_TAX_RATE_BASIS_POINTS = 888`
  (`src/lib/pos-service.ts:79, 350`), enviada por `orders-persistence-service.ts:100`. O servidor só
  valida 0–10000 (0018:327). Em outros pontos o código usa 8,875 (`orders-service.ts:82`,
  `pos-service.ts:270`, `kds-service.ts:151`).
- **Pontos-base inteiros não representam alíquotas americanas comuns**: 8,875% exigiria 887,5 bps —
  daí o 888. Qualquer motor fiscal precisa de alíquota decimal.
- Não há alíquota por loja ou organização, categoria tributável por produto, isenção, jurisdição,
  preço com imposto incluso, histórico fiscal ou relatório de imposto a recolher.
- A loja verificada do MARAO fica em Framingham, Massachusetts. A alíquota aplicável a refeições
  lá não é 8,88%. Com o código atual, o piloto **cobraria imposto errado**. As alíquotas reais
  precisam vir de configuração, confirmadas pelo contador do cliente.

### 1.5 Financeiro e despesas

- Ledger `finance_entries` (tipos `revenue`, `cogs`, `expense`, `purchase`, `reversal_revenue`,
  `reversal_cogs`; idempotência `UNIQUE(org, client_event_id, kind)`, 0012:56) gravado só por RPCs
  `SECURITY DEFINER`. O tipo `expense` nunca é gravado.
- Despesas: `finance_expenses.payload jsonb` (0014:4); o servidor valida só valor, status,
  recorrência, descrição e regra de simulação (0018:495-496). Categoria e datas não são
  validadas; recorrência é rótulo (não gera parcelas).
- **Todos os totais são calculados no navegador**: `ledgerMetrics` (`operational-metrics.ts:4-14`),
  `financialResult` (`expense-metrics.ts:95-108`), `storeResults` (`finance-model.ts:204-230`),
  `generateFinancialReport` (`finance-service.ts:926+`). Não há RPC de agregação.
- Limites de leitura: pedidos em páginas de 200 até 5.000 (`recorded-data.ts:6-35`), aviso de
  truncamento só em Unidades; Financeiro lê uma página de 200 pedidos (`finance.tsx:109`); ledger e
  despesas sem paginação (`operational.functions.ts:364-365`), sujeitos ao limite de linhas da API.
- Períodos inconsistentes: resultado do Financeiro é de todo o histórico (`finance.tsx:158-160`);
  filtros de data do relatório só mudam o rótulo (`finance-service.ts:962-965`); tendência mensal
  por mês UTC (`finance-model.ts:56`).
- Funções sem uso: `computeFinanceSummary`, `calculateDreStatement` e auxiliares de margem
  (`finance-service.ts:443-622`).
- Divergências de tela × servidor: Relatórios liberado por `role !== "staff"` (`reports.tsx:48, 83`)
  em vez de `reports.view`; `/finance` aceita `expenses.view`, mas o RLS esconde o ledger e a receita
  aparece como 0.

### 1.6 Estoque e CMV

- Movimentos `opening, adjustment, sale, reversal, receiving, transfer_in, transfer_out` (0012:51),
  idempotentes (0018:519-523). Entrada, saída, perda e ajuste da tela viram todos `adjustment`
  (0018:528); perda só se distingue pelo texto do motivo.
- Transferência entre lojas pelo `client_id`, com custo transportado e autorização nas duas lojas
  (0018:518, 529-533).
- CMV gravado no pagamento: quantidade da receita × perda × quantidade ÷ porções, × `cost_cents`
  (0018:365-368). **Custo = último custo** (o recebimento sobrescreve, 0018:557). Produto sem
  receita gera CMV 0.
- Compras: rascunho → enviado (`purchases.approve`) → parcial/recebido; cancelamento bloqueado após
  recebimento, sem devolução (0018:456, 563, 575). Imposto, frete e desconto do pedido de compra
  **não entram** no custo nem no ledger (sem custo de aquisição completo).
- Unidades: estoque limitado a `oz, lb, gal, kg, units, pack`; receitas aceitam também `g, ml, l,
tsp, tbsp, cup`. O servidor converte e rejeita pares incompatíveis (`incompatible_units`,
  0013:4); o navegador converte com outra tabela e **devolve a quantidade sem converter** quando
  não conhece o par (`src/lib/recipes-service.ts:71-91`). A prévia de custo pode divergir do CMV
  gravado. Não existe onça fluida separada da onça de peso.
- `expiration_date` existe mas nenhuma RPC grava; sem lotes; perdas não vão ao ledger.

### 1.7 Regionalização e idiomas

- Idioma por usuário (`profiles.preferred_language`; `profile-service.ts:8-22`), en-US padrão,
  pt-BR completo; paridade testada (`locale-parity.test.ts`). O SSR sempre emite `lang="en-US"`
  (`__root.tsx:115`).
- **Moeda independente do idioma, mas fixa**: `currency: "USD"` em `format.ts:1-23` e em
  `finance-service.ts` (43, 226, 825, 1237, 1272); pt-BR exibe “US$ 1.234,56”. Correto para os EUA,
  mas não é configurável.
- Fuso: `locations.timezone` validado; usado na formatação e no agrupamento por dia
  (`report-metrics.ts:15-21`), mas **o início dos períodos usa a meia-noite do navegador**
  (`recorded-data.ts:56-61`, `expense-metrics.ts:15-20`); “todas as lojas” usa o fuso da primeira.
  Não há conceito de **dia operacional** (restaurante que fecha depois da meia-noite).
- Endereço e telefone são texto livre; não há estado, ZIP, EIN nem registro fiscal estadual.
- Textos fixos fora dos arquivos de idioma, em português ou com “R$”: `intelligence-service.ts`
  (230-518), `whatsapp-service.ts` (82-87, 297), `control.subscriptions.tsx`, `control.settings.tsx`,
  `support-service.ts:71`. Preços de plano divergentes entre `control.subscriptions.tsx:533-535` e
  `tenants.ts:8-13`.

### 1.8 Integrações

- **Stripe**: só esqueleto de cobrança SaaS no banco (`stripe_webhook_events`, ids em
  `subscriptions`, RPC `billing_apply_stripe_event` 0004:143-177); sem SDK, sem rotas de servidor,
  sem webhook. Nada de pagamento no PDV.
- WhatsApp: simulação em memória (`whatsapp-service.ts`); tabela só aceita simulação (0012:77, 89).
- E-mail: modelos prontos, nenhum envio (`email-templates.ts:1-5`); só e-mails do Supabase Auth.
- Inteligência: regras e palavras-chave, sem IA (`intelligence-service.ts`, `intelligence-sources.ts`).
- Delivery, impressoras, terminais: nada. `cron-auth.ts` não é usado; não há jobs agendados.
- Não existem rotas HTTP próprias (webhooks): só funções de servidor TanStack (`createServerFn`).

### 1.9 Testes e observabilidade

- Vitest (39 arquivos), fixtures SQL (`scripts/security/reconstructed_{operations,hardening,purchases}.sql`),
  matriz de permissões (`scripts/security/permission_matrix.mjs`, 144 casos), `check-migrations`
  (journal, hashes, órfãs, 13 RPCs com checagem de permissão obrigatória), CI com banco do zero.
- Observabilidade: logs JSON com escopo (org, loja, papel, usuário), redação de segredos e dados
  pessoais, alertas por webhook e ponto de integração de exceções — **desligados por padrão**.

---

## 2. Princípios de arquitetura da Fase 1

Valem para todos os módulos.

1. **Servidor é a autoridade.** Preço, imposto, gorjeta, total, reembolso, saldo de caixa e
   relatório financeiro são calculados em SQL/servidor. O navegador só pré-visualiza e nunca
   envia valores que o servidor aceite sem recalcular.
2. **Dinheiro em centavos inteiros (`bigint` para somas); alíquotas e quantidades em `numeric`.**
   Nada de `float` para dinheiro em TypeScript: valores monetários trafegam como inteiros, alíquotas
   como string decimal. Arredondamento é uma regra configurada (por jurisdição), não um
   `Math.round` espalhado.
3. **Ledger só de acréscimo.** Nada financeiro é editado ou apagado: correções são lançamentos de
   estorno ligados ao original (`reverses_id`), como já acontece hoje.
4. **Isolamento em duas camadas.** Toda tabela nova tem `org_id` e, se operacional, `location_id`;
   RLS de leitura com `is_org_member` + `can_access_location` + permissão; escrita só por RPC
   `SECURITY DEFINER` com `assert_operational_scope` + `assert_permission`. Toda RPC nova entra na
   lista protegida do `check-migrations` e na matriz.
5. **Idempotência em toda escrita vinda de aparelho** (`client_event_id` + impressão digital), como
   no PDV atual.
6. **Configuração por organização e por loja, nunca por cliente.** Nada de `if (slug === …)`. O
   piloto é configurado com dados, não com código. Recursos novos entram atrás de chaves de
   recurso por organização (`org_features`).
7. **Compatibilidade aditiva.** Colunas e tabelas novas com padrão seguro; RPCs novas com sufixo de
   versão (`_v2`) enquanto as antigas são mantidas e depois desativadas; nenhum dado existente é
   reescrito sem migration de _backfill_ testada contra uma cópia da demo.
8. **Idiomas.** Toda string nova em en-US e pt-BR (o teste de paridade bloqueia); formatação sempre
   pelo contexto regional (seção 3.1), nunca por constante.
9. **Adaptadores para o mundo externo.** Processadores, terminais, impressoras e plataformas de
   delivery atrás de interfaces, com credenciais só no servidor, webhooks verificados e
   registrados de forma idempotente (caixa de entrada/saída).
10. **Permissões novas são explícitas** no catálogo (`permissions.ts`), nos perfis de sistema e no
    teto por papel, com migration que atualiza `effective_permissions`.

---

## 3. Arquitetura por módulo

Formato: existe → alterar → criar → tabelas → RPCs/RLS → serviços e telas → testes →
dependências → riscos.

### 3.1 Regionalização

**Existe:** idioma por usuário; `locations.timezone`; formatadores `Intl` com USD fixo; unidades
enumeradas com conversão no servidor (0013:4).

**Alterar:**

- `src/lib/format.ts`: receber um `RegionContext` (`locale`, `currency`, `timeZone`,
  `measurementSystem`, `dateStyle`) em vez de USD fixo e fuso do navegador.
- `recorded-data.ts`, `expense-metrics.ts`, `report-metrics.ts`, `finance-model.ts`: períodos pelo
  **dia operacional da loja** (fuso + hora de corte), não pela meia-noite do navegador nem por UTC.
- `recipes-service.ts:71-91`: eliminar a tabela de conversão do navegador; usar a mesma regra do
  servidor (exposta como função pura gerada a partir de uma tabela única) e falhar em par
  incompatível, como o servidor.
- Textos fixos em português e “R$” (seção 1.7) migram para os arquivos de idioma.

**Criar:**

- `org_settings` (1:1 com organização): `default_locale`, `currency` (ISO 4217, `USD` no início;
  uma moeda por organização), `measurement_system` (`us_customary|metric`), `week_start`.
- `location_settings` (1:1 com loja): `business_day_cutoff` (ex.: 04:00), sobreposições de moeda
  não permitidas; endereço estruturado (`address_line1/2`, `city`, `region` (estado), `postal_code`,
  `country` ISO 3166), `phone_e164`.
- Preferências por usuário além do idioma: formato de data/hora (12h/24h) opcional.
- Tabela única de unidades (`units`: código, dimensão `mass|volume|count`, fator para a base) com
  onça de peso e **onça fluida** distintas.

**Tabelas/relações:** `org_settings(org_id PK → organizations)`, `location_settings(location_id PK →
locations, org_id)`, `units(code PK)` (global, só leitura).

**RPCs/RLS:** `save_org_settings`, `save_location_settings` (permissões novas `settings.region`,
`settings.locations` já existe); leitura para membros. `business_day(_location_id, _ts)` e
`business_day_range(_location_id, _from, _to)` em SQL, usadas por todos os relatórios.

**Serviços/telas:** `workspace-context.tsx` passa a expor o `RegionContext` da loja ativa; Configurações
ganham “Região e formato” (organização) e endereço estruturado (loja).

**Testes:** formatação por contexto (en-US/pt-BR × USD); dia operacional com corte e horário de
verão (DST); conversão de unidades idêntica entre SQL e TS (vetores compartilhados); paridade de
idiomas.

**Dependências:** nenhuma. É base para 3.2–3.5.

**Riscos:** relatórios existentes mudam de valor quando o período passa a ser o dia da loja
(comunicar); endereços atuais são texto livre — o _backfill_ mantém o texto em `address_line1` e
marca a loja como “endereço a confirmar”.

### 3.2 Tax Engine

**Existe:** cálculo no servidor sobre o pedido inteiro com alíquota vinda do cliente; coluna
`orders.tax_rate_basis_points`.

**Alterar:**

- `create_pos_sale` → `create_pos_sale_v2`: ignora qualquer alíquota do cliente e resolve o
  imposto pela configuração da loja; calcula **por linha** e arredonda conforme a regra da
  jurisdição.
- Remover `DEFAULT_POS_TAX_RATE_BASIS_POINTS` e os 8,875 fixos; a prévia do PDV usa a mesma
  resolução (via RPC de cotação `quote_pos_sale`).

**Criar:**

- `tax_jurisdictions` (por organização): nome, tipo (`state|county|city|special`), código, país/estado.
- `tax_rates`: jurisdição, `rate numeric(9,6)` (fração), `effective_from`, `effective_to` — nunca
  editada depois de usada; mudança = nova vigência.
- `tax_categories` (ex.: `prepared_food`, `beverage_non_alcoholic`, `alcohol`, `merchandise`,
  `non_taxable`) e `tax_rules`: categoria × jurisdição → alíquota ou isenção; regra de arredondamento
  (`half_up` por linha ou por documento), preço com imposto incluso (sim/não).
- `location_tax_profiles`: quais jurisdições se somam numa loja (estado + município, por exemplo).
- `menu_products.tax_category_id` (padrão: categoria padrão da organização).
- `tax_exemptions`: isenção por pedido (motivo, documento/certificado, aprovador) com permissão
  própria.
- `order_tax_lines`: imposto calculado por pedido × jurisdição × categoria (base, alíquota aplicada,
  valor) — é o **histórico fiscal** imutável; estornos geram linhas negativas ligadas.
- Ledger: novo tipo `tax_collected` / `reversal_tax`, para o relatório de imposto a recolher.

**RPCs/RLS:** `save_tax_configuration` (`tax.manage`), `quote_pos_sale` (leitura, `pos.sell`),
`create_pos_sale_v2`; leitura de `order_tax_lines` com `finance.view` ou `reports.view` + loja.

**Serviços/telas:** Configurações → Impostos (organização: jurisdições, alíquotas, categorias;
loja: perfil fiscal); cardápio com categoria fiscal; PDV mostra imposto por linha; relatório de
imposto por jurisdição e período.

**Testes:** vetores de cálculo (alíquotas com 3+ decimais, desconto proporcional por linha,
isenção, item não tributável, imposto incluso, arredondamento por linha × por documento);
alteração de alíquota não muda pedidos antigos; matriz: só `tax.manage` altera configuração; cliente
que manda alíquota é ignorado; reembolso parcial devolve o imposto proporcional.

**Dependências:** 3.1 (dia operacional, endereço). Necessário antes de 3.3 (reembolsos) e 3.5.

**Riscos:** pedidos antigos têm `tax_rate_basis_points` (888) — permanecem como histórico, sem
recálculo; o relatório fiscal só é confiável a partir da ativação do motor por loja. **O sistema
não decide a legislação**: alíquotas, categorias e regras são configuradas e validadas pelo
contador do cliente. Integração futura com serviço de cálculo (Avalara, TaxJar, Stripe Tax) fica
atrás da mesma interface.

### 3.3 Payments

**Existe:** um registro `payments` por pedido, método como rótulo, estorno total por cancelamento.

**Alterar:**

- `payments`: remover `UNIQUE(order_id)`; acrescentar `sequence`, `tender_type`
  (`cash|card|gift_card|external|other`), `amount_cents`, `tip_cents`, `cash_tendered_cents`,
  `change_cents`, `status` (`pending|authorized|captured|voided|refunded|partially_refunded|failed`),
  `processor`, `processor_ref`, `card_brand`, `card_last4`, `entry_mode`, `drawer_session_id`,
  `idempotency_key`. Os registros atuais viram `sequence = 1`, `status = captured`.
- `orders`: `paid_cents`, `tip_cents`, `balance_cents`, status de pagamento derivado
  (`unpaid|partially_paid|paid|refunded`).
- `finalize_pos_sale_atomic` → fluxo em duas etapas: `create_pos_sale_v2` (pedido aberto) +
  `add_payment` (um ou mais pagamentos) + fechamento automático quando o saldo zera. O fluxo atual
  continua disponível como atalho “pagamento único”.

**Criar:**

- `order_checks` (divisão de conta): subconta por pedido, itens ou valores atribuídos.
- `refunds` + `refund_items`: reembolso total, parcial ou por item; ligado ao pagamento original;
  devolve imposto e estoque (opcional, por motivo) e lança estornos no ledger.
- `voids`: anulação de item/pedido antes do pagamento (sem impacto financeiro, com auditoria).
- Gorjetas: `tip_cents` por pagamento + `tip_adjustments` (ajuste de gorjeta após autorização, típico
  de restaurante americano). **Gorjeta não é receita**: ledger `tip_liability` (a repassar à
  equipe). Repartição entre funcionários (_tip pooling_) fica para o módulo futuro de mão de obra.
- Taxa de serviço (_service charge_ / _auto-gratuity_) como linha do pedido, tributável conforme a
  configuração fiscal.
- Interface `PaymentProcessorAdapter` (servidor): `authorize`, `capture`, `adjustTip`, `void`,
  `refund`, `status`, verificação de webhook. Implementações: `manual` (registro sem processador —
  o comportamento atual) e, quando houver decisão, o processador do piloto.
- `payment_events` (caixa de entrada idempotente de webhooks) e `integration_connections`
  (credenciais por organização em armazenamento seguro do servidor; nunca no navegador).

**RPCs/RLS:** `add_payment`, `void_payment`, `adjust_tip`, `refund_order` (parcial/total),
`void_order_item`; permissões novas `payments.take`, `payments.refund_partial`,
`payments.tip_adjust`, `orders.void` (o `orders.refund` atual vira o reembolso total).
Leitura de pagamentos por loja com `orders.view`/`finance.view`.

**Serviços/telas:** PDV com múltiplas formas, divisão por item/valor/igual, gorjeta sugerida (%),
troco calculado no servidor; tela de reembolso com seleção de itens; recibo com detalhamento.

**Testes:** soma dos pagamentos = total + gorjeta; pagamento parcial mantém pedido aberto;
idempotência por pagamento; reembolso nunca excede o capturado; reembolso parcial devolve imposto
proporcional e não mexe em estoque salvo se pedido; ajuste de gorjeta só em pagamento elegível;
webhook repetido não duplica; matriz por perfil (caixa paga, só gerente reembolsa, etc.).

**Dependências:** 3.2 (imposto por linha para reembolso proporcional). Processador real depende da
decisão do piloto.

**Riscos:** remover `UNIQUE(order_id)` exige revisar `finalize_pos_sale_atomic`, o cancelamento
(que hoje estorna “todas as linhas”) e as fixtures SQL; **PCI**: o Dinequora nunca deve tocar no
número do cartão — só terminais/tokens do processador (escopo PCI mínimo); regras de gorjeta e
taxa de serviço variam por estado — configuráveis, validadas pelo cliente.

### 3.4 Cash Management

**Existe:** nada além do rótulo `cash`.

**Criar:**

- `cash_drawers` (por loja: nome, aparelho/terminal associado).
- `drawer_sessions`: abertura (fundo de troco), responsável, aparelho, abertura/fechamento,
  esperado × contado, diferença, status (`open|closing|closed|reviewed`).
- `drawer_movements`: `sale_cash`, `refund_cash`, `paid_in` (reforço), `paid_out` (pagamento em
  dinheiro), `drop` (sangria para cofre), `tip_payout`, `adjustment`; motivo, aprovador.
- `drawer_counts`: contagem por cédula/moeda (opcional), contagem cega (o operador não vê o
  esperado), tolerância configurada por loja.
- `shift_reports` (relatório X parcial / Z de fechamento) gerados no servidor e imutáveis.

**Alterar:** `add_payment` em dinheiro exige sessão de caixa aberta no aparelho (configurável).

**RPCs/RLS:** `open_drawer_session`, `record_drawer_movement`, `close_drawer_session`,
`review_drawer_session`; permissões `cash.open`, `cash.close`, `cash.paid_in_out`, `cash.drop`,
`cash.review`, `cash.view_reports`.

**Serviços/telas:** abertura/fechamento no PDV; tela de conferência do gerente; histórico de
sessões com diferenças; alerta de diferença acima da tolerância (via observabilidade).

**Testes:** esperado = fundo + vendas em dinheiro − reembolsos − saídas + reforços − sangrias;
fechamento cego; sessão fechada é imutável; duas sessões abertas no mesmo caixa são recusadas;
permissões por perfil; idempotência de movimentos.

**Dependências:** 3.3 (pagamentos por forma).

**Riscos:** baixo para dados existentes (tudo novo). Operacional: exige treinamento; política de
caixa (cego, tolerância, quem aprova) é decisão do cliente.

### 3.5 Financial Intelligence

**Existe:** ledger confiável no servidor; cálculos e consolidação no navegador com limites.

**Alterar:** Financeiro, Relatórios, Visão geral e Unidades passam a ler **agregados do servidor**;
os cálculos de navegador (`operational-metrics`, `expense-metrics`, `finance-model`,
`report-metrics`) ficam só para formatação. Remover código sem uso (`finance-service.ts:443-622`).
Corrigir as divergências de tela × permissão (seção 1.5).

**Criar:**

- `daily_location_summary` (por loja × dia operacional): vendas brutas, descontos, líquido, imposto,
  gorjetas, pedidos, ticket médio, CMV, compras, despesas, por forma de pagamento; mantida por
  gatilho/rotina idempotente e **recalculável** a partir do ledger.
- Despesas estruturadas: colunas reais (`category`, `competency_date`, `due_date`, `paid_at`,
  `supplier_id`) em vez de `jsonb` livre; recorrência gerando lançamentos; categorias de plano de
  contas simples (`chart_of_accounts` por organização, com modelo padrão de restaurante americano:
  vendas, CMV de alimentos/bebidas, mão de obra, ocupação, operacional…).
- RPCs de relatório: `report_pnl(_org, _locations[], _from, _to, _granularity)`,
  `report_sales`, `report_tax_liability`, `report_cash_flow`, `report_payments_settlement`,
  `report_prime_cost` (exige mão de obra — inicialmente via categoria de despesa), todas com escopo
  de loja e permissão (`reports.view`, `dashboard.financials`, `finance.view`).
- Fechamento de período (`period_closes`): trava lançamentos retroativos num mês fechado
  (correções vão para o período aberto).
- Estoque: custo médio ponderado (opcional por organização) e custo de aquisição com
  frete/imposto/desconto da compra; perdas lançadas no ledger; variação real × teórica.

**Testes:** agregado do servidor = soma do ledger (propriedade verificada em SQL); consolidação
multiunidade respeita o escopo de loja do usuário; fuso/dia operacional; período fechado recusa
lançamento; desempenho com volume sintético (ex.: 3 lojas × 1 ano).

**Dependências:** 3.1, 3.2, 3.3, 3.4.

**Riscos:** números exibidos hoje (calculados no navegador, com limites) podem diferir dos novos —
validar lado a lado na demo antes de trocar; despesas atuais em `jsonb` precisam de _backfill_ para
as colunas novas.

### 3.6 Hardware & Integrations

**Existe:** nada (só `window.print()`).

**Criar:**

- Camada de integrações no servidor: `integration_connections` (organização/loja, provedor,
  status, credenciais em cofre do servidor), `integration_events_in` (webhooks recebidos,
  idempotentes, com verificação de assinatura) e `integration_events_out` (fila de envio com
  novas tentativas).
- **Rotas HTTP de servidor para webhooks** — hoje inexistentes. Decidir entre rotas do servidor
  TanStack Start e Supabase Edge Functions (seção 7).
- Interfaces:
  - `PaymentTerminalAdapter` (pareamento, enviar valor ao terminal, cancelar, status).
  - `PrinterAdapter` (recibo, comanda de cozinha, relatório Z): ESC/POS em rede local ou serviço
    de impressão em nuvem do fabricante; modelos de recibo por organização em en-US/pt-BR.
  - `DeliveryPlatformAdapter` (receber pedido, confirmar, atualizar status, sincronizar cardápio e
    disponibilidade) — exige contrato de parceiro com cada plataforma.
  - Notificações (e-mail transacional, SMS/WhatsApp) atrás da mesma camada.
- `devices` (por loja: PDV, KDS, impressora, terminal) e `kds_stations` (estação real por produto ou
  categoria, substituindo a dedução pelo nome).

**RPCs/RLS:** `register_device`, `save_integration_connection` (`integrations.manage`); leitura do
status por gerente; eventos só pelo servidor (`service_role`).

**Testes:** adaptadores simulados com testes de contrato; webhook com assinatura inválida
recusado; evento repetido não duplica pedido; fila reprocessa após falha; credenciais nunca
aparecem em logs (redação já existente).

**Dependências:** 3.3 para terminais; o restante pode avançar em paralelo a 3.4/3.5.

**Riscos:** cada provedor tem homologação, contrato e limites próprios; dependência de rede local
para impressoras; nunca expor credenciais ao navegador.

### 3.7 Pilot Readiness (MARAO como primeiro cliente, sem dependência de código)

**Existe:** estratégia de organização de produção separada da demo
(`docs/operations/data-layers-and-marao-production.md`); seeds separados por camada; isolamento
testado.

**Criar/preparar:**

- Organização de produção nova (não reutilizar `org_marao` da demo), com 3 lojas configuradas por
  dados: endereço estruturado, fuso, horário, dia operacional, perfil fiscal, caixas, aparelhos.
- Importação de dados: cardápio, modificadores, categorias fiscais, insumos, receitas,
  fornecedores, equipe (scripts de importação genéricos, com validação e simulação antes de gravar).
- `org_features`: ligar módulos por organização (piloto primeiro).
- Prontidão operacional: manual de implantação, checklist de _go-live_, treinamento por perfil,
  plano de contingência (pagamento manual se o processador falhar), suporte e alertas ativos.
- Ambiente: projeto hospedado de produção separado; backups e restauração testados; monitoramento.

**Testes:** ensaio completo num ambiente de _staging_ com a configuração do piloto (sem dados
reais de clientes), roteiros de aceite por perfil, fechamento de caixa e relatório fiscal de um
dia simulado.

**Dependências:** todos os módulos anteriores e as decisões da seção 7.

**Riscos:** informações pendentes (endereços das lojas 2 e 3, processador, terminais, alíquotas);
dados reais de clientes exigem política de privacidade e retenção.

---

## 4. Migrations e estabilidade

### 4.1 Achados

| Item                   | Situação real                                                                                   | Consequência                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `drizzle/schema.ts`    | Em branco de propósito (“auto-generated and intentionally left blank”)                          | O Drizzle **não** modela o esquema; é só o executor das migrations SQL           |
| Snapshots 0000–0016    | Existem, mas **todos vazios** (0 tabelas, 0 enums); cadeia `id/prevId` íntegra                  | Não guardam esquema; `drizzle-kit check` passa                                   |
| Snapshots 0017–0020    | Ausentes                                                                                        | Sem impacto: seriam vazios. `drizzle-kit migrate` não usa snapshots              |
| `drizzle-kit generate` | Compararia um `schema.ts` vazio com snapshot vazio                                              | **Nunca deve ser usado**; poderia gerar migration destrutiva ou vazia            |
| Versões                | `package.json` declara `drizzle-kit`/`drizzle-orm` como `0.x`; o lockfile fixa 0.31.11 / 0.45.4 | `npm install` sem lock poderia trocar a versão do executor                       |
| Journal                | 21 entradas, índices e datas crescentes, hashes iguais na demo e em banco novo                  | Íntegro                                                                          |
| Órfãs 0010/0011/0012   | Preservadas, fora do journal, bloqueadas pela CI                                                | A `0011` rebaixa `create_pos_sale` se executada à mão                            |
| `0021` proposta        | Em `docs/proposed-migrations/`, fora do journal                                                 | Ocupa o próximo número; precisa de decisão antes da primeira migration da Fase 1 |
| Tipos TypeScript       | `src/integrations/supabase/types.ts` gerado do banco                                            | Precisa ser regenerado a cada migration                                          |

### 4.2 Estratégia de reconciliação (proposta; nada executado)

1. **Declarar oficialmente o modelo “SQL primeiro”**: migrations escritas à mão, aplicadas por
   `drizzle-kit migrate`; `schema.ts` continua em branco; `drizzle-kit generate` proibido.
   Documentar em `docs/operations/` e acrescentar ao `check-migrations`:
   - falha se `schema.ts` deixar de estar em branco;
   - falha se surgir snapshot com tabelas (sinal de `generate`);
   - snapshots 0017+ **não** serão criados (não há o que registrar); a regra fica explícita para não
     parecer pendência.
2. **Fixar as versões** `drizzle-kit` e `drizzle-orm` no `package.json` (exatas, iguais ao lock).
3. **Numeração**: decidir a `0021` antes de tudo.
   - Opção A (recomendada): aprovar a `0021_remove_seed_demo_orgs_on_fresh_databases` como primeira
     migration da Fase 1 (no-op comprovado na demo; remove as orgs semeadas só em banco sem
     usuários), e a demo passa a recriá-las pelo seed de demonstração.
   - Opção B: descartar a proposta e começar a Fase 1 na `0021` com outra migration; a remoção das
     orgs semeadas passa a ser feita só no projeto de produção.
4. **Regras para toda migration nova** (checadas na revisão e, quando possível, pela CI):
   - nunca editar 0000–0020; correções sempre em migration nova;
   - aditiva: colunas novas com padrão seguro ou nulas; constraint nova com `NOT VALID` +
     `VALIDATE` quando houver dados; remoção de constraint/coluna só depois de uma versão sem uso;
   - RPC alterada em assinatura → nova função `_v2`; a antiga permanece até a remoção planejada;
   - toda RPC de escrita entra na lista protegida do `check-migrations`;
   - toda tabela nova com RLS habilitado e política explícita (checagem nova na CI: nenhuma tabela
     em `public` sem RLS);
   - `GRANT`/`REVOKE` explícitos (`authenticated` só executa o necessário; `anon` nada).
5. **Ensaio de atualização com dados reais da demo** (local, nunca na CI, porque o dump contém
   dados de usuários): restaurar o dump da demo num banco descartável, aplicar as migrations novas,
   comparar contagens e invariantes (soma do ledger, estoque, pagamentos = totais). Passa a ser
   obrigatório antes de cada PR com migration.
6. **Na CI**: além do banco do zero (já existe), um _seed_ sintético maior (3 lojas, histórico) para
   testar _backfills_ e desempenho dos agregados.
7. **Tipos**: regenerar `types.ts` no mesmo commit da migration; a CI compara o arquivo gerado com o
   versionado.

---

## 5. Priorização em subfases

Ordem: 1.0 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.7, com 1.6 em paralelo a partir do fim de 1.3.
Cada subfase termina com PR próprio, CI verde, matriz ampliada e ensaio de atualização na cópia
da demo.

### 1.0 — Fundação técnica e segurança

- **Objetivo:** preparar o terreno sem mudar comportamento visível.
- **Entregáveis:** política “SQL primeiro” e guardas novas no `check-migrations` (schema em branco,
  snapshots, RLS obrigatório, RPCs protegidas); versões do Drizzle fixadas; decisão e aplicação da
  `0021`; `has_permission` conferindo a organização da loja; correção das divergências tela ×
  permissão (Relatórios, Financeiro); biblioteca de dinheiro/decimal em TS (sem `float`); conversão
  de unidades única (servidor como fonte, vetores compartilhados com TS); script de ensaio de
  atualização com a cópia da demo; `org_features`.
- **Dependências:** nenhuma.
- **Aceite:** CI verde; matriz com caso novo de usuário em duas organizações (deve falhar antes da
  correção e passar depois); nenhuma diferença nos números da demo; prévia de custo de receita
  igual ao CMV do servidor em todos os vetores.
- **Testes obrigatórios:** unitários das bibliotecas; SQL do `has_permission`; ensaio de
  atualização com a demo.
- **Riscos:** baixos; a correção do `has_permission` pode revelar chamadas que dependiam do
  comportamento antigo (a matriz e as fixtures cobrem).

### 1.1 — Regionalização

- **Objetivo:** idioma, moeda, fuso, formato e unidades independentes e configuráveis.
- **Entregáveis:** `org_settings`, `location_settings` (endereço estruturado, dia operacional),
  `units`; `RegionContext` em toda a formatação; períodos pelo dia operacional; textos fixos
  migrados para os arquivos de idioma.
- **Dependências:** 1.0.
- **Aceite:** nenhuma ocorrência de `"USD"`, `"R$"` ou `toLocale*("pt-BR")` fora da camada de
  formatação; relatório de uma loja em fuso diferente do navegador mostra o dia certo; DST testado.
- **Testes obrigatórios:** formatação, dia operacional, paridade de idiomas, RLS das tabelas novas.
- **Riscos:** mudança de valores em relatórios existentes (comunicar e comparar lado a lado).

### 1.2 — Tax Engine

- **Objetivo:** imposto autoritativo no servidor, por loja, jurisdição e categoria, com histórico.
- **Entregáveis:** tabelas fiscais, `quote_pos_sale`, `create_pos_sale_v2`, `order_tax_lines`,
  ledger de imposto, telas de configuração e relatório de imposto a recolher.
- **Dependências:** 1.1.
- **Aceite:** o cliente não consegue influenciar a alíquota; vetores fiscais 100% corretos; mudança
  de alíquota não altera pedidos antigos; relatório fiscal = soma das linhas fiscais.
- **Testes obrigatórios:** vetores de cálculo, matriz (`tax.manage`), idempotência, regressão do PDV.
- **Riscos:** configuração fiscal errada pelo usuário — mitigar com tela de simulação e validação
  pelo contador antes de ativar a loja.

### 1.3 — Payments (núcleo independente de processador)

- **Objetivo:** múltiplos pagamentos, divisão, parciais, gorjetas, reembolsos e anulações.
- **Entregáveis:** `payments` ampliada, `order_checks`, `refunds`, `voids`, ajustes de gorjeta,
  taxa de serviço, adaptador `manual`, interface `PaymentProcessorAdapter`, PDV atualizado.
- **Dependências:** 1.2.
- **Aceite:** invariantes de pagamento (seção 3.3) verificadas em SQL; reembolso parcial correto em
  imposto e ledger; fluxo atual de pagamento único continua funcionando.
- **Testes obrigatórios:** fixtures SQL novas, matriz por perfil, idempotência, regressão completa.
- **Riscos:** alteração de `payments` com dados existentes (ensaio na cópia da demo obrigatório).

### 1.4 — Cash Management

- **Objetivo:** caixa auditável por loja e aparelho.
- **Entregáveis:** caixas, sessões, movimentos, contagem cega, relatórios X/Z, telas de abertura,
  fechamento e conferência.
- **Dependências:** 1.3.
- **Aceite:** fórmula do esperado verificada; sessão fechada imutável; diferença acima da tolerância
  gera alerta; permissões por perfil.
- **Testes obrigatórios:** SQL de invariantes, matriz, idempotência.
- **Riscos:** operacionais (treinamento, política de caixa).

### 1.5 — Financial Intelligence (servidor)

- **Objetivo:** todos os números financeiros calculados no servidor, consolidados por loja e período.
- **Entregáveis:** `daily_location_summary`, RPCs de relatório (P&L, vendas, imposto, fluxo de caixa,
  liquidação por forma de pagamento, _prime cost_ provisório), despesas estruturadas e plano de
  contas, fechamento de período, custo de aquisição e custo médio opcional.
- **Dependências:** 1.1–1.4.
- **Aceite:** agregados = ledger; telas sem limite de 5.000 pedidos; consolidação respeita o
  escopo de loja; desempenho aceitável com 3 lojas × 1 ano sintético.
- **Testes obrigatórios:** propriedades SQL, matriz de leitura, desempenho, comparação lado a lado
  com os números atuais da demo.
- **Riscos:** _backfill_ de despesas; diferença de números em relação às telas antigas.

### 1.6 — Hardware & Integrations (em paralelo a partir de 1.3)

- **Objetivo:** camada de adaptadores, sem acoplamento a fornecedor.
- **Entregáveis:** rotas de webhook, `integration_connections`, filas de entrada/saída, `devices`,
  `kds_stations`, adaptadores simulados; impressão ESC/POS em rede; depois, os adaptadores reais
  escolhidos (processador/terminal, delivery).
- **Dependências:** 1.3 para terminais; decisões do piloto para adaptadores reais.
- **Aceite:** testes de contrato dos adaptadores; webhook inválido recusado; evento duplicado
  ignorado; credenciais nunca expostas.
- **Riscos:** homologação e contratos com terceiros.

### 1.7 — Pilot Readiness

- **Objetivo:** implantar o primeiro cliente sem código específico.
- **Entregáveis:** projeto de produção, organização nova configurada por dados, importação,
  treinamento, manual de implantação, _go-live_ e acompanhamento.
- **Dependências:** 1.0–1.6 e decisões do cliente.
- **Aceite:** ensaio completo em _staging_ aprovado por perfil; um dia simulado fechado com caixa e
  relatório fiscal conferidos.
- **Riscos:** prazos de terceiros e informações pendentes.

### 5.1 O que pode começar agora × o que depende do MARAO

| Pode ser feito agora                                     | Depende de informação do MARAO (ou de decisão sua)                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1.0 inteira                                              | Processador de pagamentos e modelo de terminal                                   |
| 1.1 inteira (endereços como configuração)                | Endereços das lojas 2 e 3 (só Framingham está verificado)                        |
| 1.2 motor completo, com alíquotas configuráveis          | Alíquotas, categorias e registros fiscais confirmados pelo contador              |
| 1.3 núcleo + adaptador `manual`                          | Políticas de gorjeta, taxa de serviço e reembolso                                |
| 1.4 inteira (política configurável)                      | Política de caixa (contagem cega, tolerância, aprovador)                         |
| 1.5 inteira                                              | Plano de contas preferido e se a mão de obra entra por despesa ou por integração |
| 1.6 camada de integração, impressão genérica, simulações | Impressoras, plataformas de delivery, contratos de parceiro                      |
| —                                                        | 1.7: cardápio, receitas, insumos, fornecedores, equipe, data de implantação      |

---

## 6. Diferencial competitivo: IA (planejamento, não implementação)

Princípio: **a IA nunca enxerga mais do que o usuário que a aciona**.

- **Acesso a dados:** a IA consulta só as RPCs de relatório da 1.5 (e futuras RPCs de leitura
  específicas), executadas **com o token do usuário** — nunca com `service_role`. RLS, escopo de
  loja e permissões valem automaticamente. Nada de SQL livre gerado por modelo.
- **Contexto mínimo:** agregados em vez de linhas; dados pessoais de clientes (nome, telefone,
  e-mail) removidos pela mesma redação da observabilidade; nenhum dado de outra organização.
- **Consentimento e controle:** ativação por organização (`org_features.ai`), escolha de quais
  módulos a IA pode ler, registro em auditoria de cada consulta (quem, o quê, quando) e limite de
  custo por organização. Sem treinamento de modelos com dados de clientes.
- **Automação com aprovação humana:** a IA só cria **propostas** (`ai_proposals`: tipo, conteúdo,
  justificativa, dados usados, status `pending|approved|rejected|executed`). A execução acontece
  pela RPC normal, **com as permissões de quem aprova**, e fica auditada. Ex.: sugerir pedido de
  compra, ajuste de preço, alerta de desvio de caixa.
- **Previsões e recomendações:** dependem do histórico consolidado da 1.5 (`daily_location_summary`):
  previsão de vendas por loja e dia, sugestão de compras pelo consumo das receitas, alerta de
  margem e de _prime cost_, comparação entre lojas da mesma organização.
- **Entre organizações:** comparativos de mercado só com dados agregados, anonimizados e com
  consentimento explícito — fase posterior.
- **Arquitetura:** provedor de IA atrás de um adaptador no servidor (chave só no servidor);
  respostas sempre citando os números de origem; avaliação contínua com casos de teste por idioma
  (en-US/pt-BR).
- **Pré-requisitos:** 1.5 concluída, observabilidade com provedor ativo, política de privacidade
  publicada.

---

## 7. Decisões que dependem do responsável

1. **0021**: aprovar como primeira migration da Fase 1 (opção A) ou descartar (opção B) — seção 4.2.
2. **Processador de pagamentos e terminais** do piloto (ex.: Stripe Terminal, Square, Adyen,
   Clover/Fiserv) — define o primeiro adaptador real e o escopo PCI.
3. **Execução de webhooks e integrações**: rotas do servidor TanStack Start × Supabase Edge Functions
   (e onde o app será hospedado em produção).
4. **Endereços das lojas 2 e 3** do MARAO, perfil fiscal de cada loja e validação das alíquotas
   pelo contador.
5. **Políticas operacionais padrão**: gorjeta sugerida, taxa de serviço, reembolso (quem aprova),
   caixa (contagem cega, tolerância), dia operacional (hora de corte).
6. **Impressoras e plataformas de delivery** desejadas e contratos de parceiro.
7. **Moeda**: confirmar uma moeda por organização (USD para os EUA) — sem multimoeda na Fase 1.
8. **Mão de obra**: na Fase 1 via categoria de despesa (_prime cost_ provisório) ou módulo de
   ponto/escala dedicado (fase futura).
9. **Projeto hospedado de produção** separado da demo e do QA; responsável por credenciais.
10. **E-mail de suporte e provedor de alertas/exceções** (pendentes da Fase 0).
11. **Aurora Table Co. (Demo)** está com `is_demo = false` — confirmar.
12. **Repositório público**: manter ou tornar privado antes de entrar código de integração e
    documentação operacional do piloto.

---

## 8. Primeira subfase recomendada: 1.0 — Fundação técnica e segurança

Motivos: não depende de nenhuma informação do MARAO, reduz o risco de todas as subfases seguintes
e não muda nada que o usuário vê.

Escopo proposto, em PR único com commits por item:

1. Política “SQL primeiro” documentada + guardas no `check-migrations` (schema em branco, snapshots
   sem tabelas, toda tabela `public` com RLS, lista de RPCs protegidas ampliável).
2. Versões exatas de `drizzle-kit` e `drizzle-orm` no `package.json`.
3. Decisão da `0021` (aplicar ou descartar) — primeira migration da fase, se aprovada.
4. `has_permission` conferindo `l.org_id = _org_id` (migration nova) + caso na matriz.
5. Correção das divergências tela × permissão em Relatórios e Financeiro.
6. Biblioteca de dinheiro/decimal e conversão de unidades única (servidor como fonte; vetores
   compartilhados).
7. Script local de ensaio de atualização com a cópia da demo (sem dados na CI).
8. `org_features` (chaves de recurso por organização), sem nenhum recurso ligado ainda.

Critério de pronto da 1.0: CI verde, matriz ampliada passando, ensaio de atualização da demo sem
diferenças, nenhum número da demo alterado.

Nada desta lista será iniciado sem aprovação.
