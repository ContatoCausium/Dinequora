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

**Criar loja = uma transação.** `create_location_with_tax_rate(_org_id, _name, _address,
_timezone, _phone, _tax_rate_ppm)` (só proprietário, como `create_location`) valida a alíquota
antes de gravar qualquer coisa e delega a `create_location` e `set_location_tax_rate` na mesma
transação: ou a loja existe com a alíquota (auditorias `location.created` e
`location.tax_rate_updated` com `from_ppm` nulo), ou nada foi gravado. A tela de criação chama só
essa RPC. Na edição, os dados da loja e a alíquota continuam sendo duas RPCs (`save_location_with_managers`
e `set_location_tax_rate`, assinaturas já publicadas); se a segunda falhar, a tela diz exatamente
isso ("os dados foram salvos, mas a alíquota não: …") e recarrega o estado gravado. A RPC composta
está em `REVIEWED` no `scripts/qa/check-migrations.mjs` (delegações auditadas).

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
5. **Concorrência.** A venda lê a linha da loja com `FOR SHARE`; `set_location_tax_rate` a bloqueia
   com `FOR UPDATE` antes de alterar. Uma alteração de alíquota espera a transação de uma venda que
   já leu a alíquota terminar (a venda é gravada com a alíquota que validou); uma venda que chega
   durante uma alteração espera o commit e então lê a alíquota nova — a confirmação da alíquota
   antiga é recusada (`tax_rate_changed`) e a da nova é gravada com a nova. Vendas entre si não se
   bloqueiam (`FOR SHARE` é compatível com `FOR SHARE`). Nenhuma venda registra uma alíquota que o
   servidor não tenha validado na mesma transação.

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
  anteriores, leituras por RLS, grants, criação de loja com alíquota numa transação (só owner,
  nada gravado em caso de recusa, auditorias, venda imediata na loja nova).
- `scripts/security/tax_rate_concurrency.mjs` (suíte, passo 5c): duas sessões PostgreSQL —
  venda antes da alteração (a alteração espera, `pg_blocking_pids`), alteração antes da venda (a
  venda espera e lê a alíquota nova: antiga recusada, nova gravada), alteração desfeita (venda
  recusada, nada gravado), duas vendas simultâneas sem espera, invariante imposto = alíquota
  validada em todos os pedidos.
- `scripts/security/permission_matrix.mjs`, seção "Store sales tax": por perfil, contra a loja
  própria e contra a outra loja; criação de loja com alíquota (caixa, gerente e outra organização
  negados; alíquota inválida nada grava; owner cria com as duas auditorias).
- `scripts/qa/seed-qa-org.mjs`: QA Downtown a 6,25 % (`set_location_tax_rate`) e QA Riverside a
  8,875 % (`create_location_with_tax_rate`).
- Vitest: `money-units`, `money-display`, `pos-service`, `orders-persistence`,
  `operational-contracts` (ppm, arredondamento, sessão, confirmação), `onboarding-checklist`
  (loja configurada exige alíquota explícita).

## Onboarding e primeira loja

`create_test_restaurant` (onboarding) e `create_organization` criam a primeira loja **sem
alíquota** (`tax_rate_ppm` nulo); nenhum valor padrão é inventado. Antes da primeira venda:

1. o servidor recusa qualquer venda dessa loja (`tax_rate_not_configured`), inclusive pelas
   assinaturas antigas;
2. o PDV mostra o aviso e desabilita a cobrança, com link para Localizações;
3. a etapa obrigatória "Configure suas unidades" do checklist de onboarding só fica concluída
   quando alguma loja tem endereço, horários **e** alíquota explícita (`storeConfigured`); a
   folha de edição da loja não salva sem uma alíquota válida (0 é válido e explícito);
4. o seletor de lojas marca "Configuração pendente" enquanto faltar alíquota.

Ou seja, toda organização nova tem a alíquota configurada explicitamente por um proprietário (ou
gerente com `settings.locations`) antes de registrar qualquer venda.

## Ao aplicar a 0025 num ambiente existente

Toda loja fica **sem alíquota** e o PDV dessa loja bloqueia vendas até um proprietário ou gerente
configurá-la. O demo (MARAO, Harbor, Aurora) e a QA persistente precisam das alíquotas definidas
depois da migration; os seeds não fixam alíquotas (dados de demonstração ficam fora de migrations
estruturais).
