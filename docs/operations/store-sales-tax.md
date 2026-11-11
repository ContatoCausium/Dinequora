# Imposto sobre vendas por loja (migration 0025)

Status: **em vigor** a partir da branch `fix/backend-stabilization`. Uma alíquota única por loja,
cobrada pelo servidor. **Não é um motor fiscal dos Estados Unidos**: não há tabelas de jurisdição,
categorias tributárias por produto, isenções, preço com imposto incluso nem apuração. A feature
`tax_engine` do catálogo (0022) continua reservada para isso; a alíquota básica desta página não é
gateada por feature nenhuma.

## Modelo

- `locations.tax_rate_ppm integer NULL` — a alíquota em **partes por milhão** (1.000.000 = 100 %;
  88.750 = 8,875 %). Pontos-base inteiros não representam alíquotas americanas comuns com três
  casas (NJ 6,625 %, NYC 8,875 %, Minneapolis 9,025 %); ppm representa até quatro casas de
  porcento.
- `NULL` = **não configurada**: a loja não registra nenhuma venda (`tax_rate_not_configured`) e o
  PDV bloqueia o checkout com um aviso. `0` é uma alíquota válida e explícita (onde não há imposto
  sobre vendas).
- `orders.tax_rate_ppm` registra a alíquota exata cobrada em cada pedido; `tax_rate_basis_points`
  continua preenchido com `round(ppm / 100)` para os leitores antigos. Pedidos anteriores à 0025
  receberam `ppm = bp × 100`.

## Quem configura

`set_location_tax_rate(_location_id, _tax_rate_ppm)`: a mesma autorização de `update_location` —
membro que não seja staff, com acesso à loja; proprietários sempre, gerentes por
`settings.locations` naquela loja. Cada alteração grava `location.tax_rate_updated` no audit log
com a alíquota anterior e a nova. Um membro de outra organização, um staff, ou um gerente sem acesso
à loja recebem `forbidden`. A RPC está em `GUARDED` no `scripts/qa/check-migrations.mjs`.

Na interface: Localizações → criar ou editar loja → "Alíquota de imposto sobre vendas (%)". O campo
é obrigatório ao criar; o texto é convertido exatamente (8.875 → 88.750 ppm), sem `parseFloat`.

## Como a venda é cobrada

`create_pos_sale_v2` / `finalize_pos_sale_atomic_v2` / `persist_finalized_pos_sale_atomic_v2`
recebem `_tax_rate_ppm`: **a alíquota que o cliente exibiu**, usada só como confirmação.

1. A loja sem alíquota → `tax_rate_not_configured`.
2. Alíquota exibida ≠ alíquota da loja (comparação exata em ppm) → `tax_rate_changed`. O cliente
   nunca escolhe a alíquota; uma diferença de 1 ppm é recusada.
3. Imposto = `round((subtotal − desconto) × ppm_da_loja / 1.000.000)`, meio-para-longe-de-zero
   (`round(numeric)` do PostgreSQL), igual a `applyPartsPerMillion` em `src/lib/money.ts`.
4. A repetição idempotente de uma venda já gravada (mesmo `client_order_id` e payload) devolve o
   pedido existente mesmo que a alíquota tenha mudado depois: a busca de idempotência vem antes da
   regra.

As assinaturas anteriores (`create_pos_sale`, `finalize_pos_sale_atomic`,
`persist_finalized_pos_sale_atomic`, com `_tax_rate_basis_points`) continuam existindo, como manda a
política de migrations, e delegam às v2 com `bp × 100`: um cliente antigo confirma uma alíquota de
duas casas e nunca contorna a alíquota da loja (888 bp numa loja a 8,875 % é recusado).

## No PDV

- A sessão recebe a alíquota da loja ativa (`org.locations[].taxRatePpm`); o rótulo "Imposto (8,875 %)"
  e a prévia usam o mesmo ppm que será confirmado ao servidor.
- Loja sem alíquota: aviso no ticket, link para Localizações (quem tem `settings.locations`) e
  botão de cobrança desabilitado.
- Alíquota alterada com uma comanda aberta: a comanda aberta é recalculada assim que a workspace
  recarrega; se a venda já tiver sido enviada com a alíquota antiga, o servidor recusa com
  `tax_rate_changed`, o PDV recarrega a organização, recalcula e explica.
- Comandas em espera (`localStorage`) são retomadas com a alíquota **atual** da loja, nunca com a
  alíquota guardada na espera.

## Testes

- `scripts/security/store_sales_tax.sql` (suíte, transação revertida): loja sem alíquota, quem pode
  configurar (owner, gerente só na própria loja, staff e outra organização negados, auditoria),
  confirmação exata (0 %, 100 %, 1 ppm de diferença, NULL), 6,25 % e 8,875 % com desconto,
  0 % explícito, mudança de alíquota com comanda aberta, replay idempotente, assinaturas
  anteriores, leituras por RLS, grants.
- `scripts/security/permission_matrix.mjs`, seção "Store sales tax": por perfil, contra a loja
  própria e contra a outra loja.
- `scripts/qa/seed-qa-org.mjs`: QA Downtown a 6,25 % e QA Riverside a 8,875 %.
- Vitest: `money-units`, `money-display`, `pos-service`, `orders-persistence`,
  `operational-contracts` (ppm, arredondamento, sessão, confirmação).

## Ao aplicar a 0025 num ambiente existente

Toda loja fica **sem alíquota** e o PDV dessa loja bloqueia vendas até um proprietário ou gerente
configurá-la. O demo (MARAO, Harbor, Aurora) e a QA persistente precisam das alíquotas definidas
depois da migration; os seeds não fixam alíquotas (dados de demonstração ficam fora de migrations
estruturais).
