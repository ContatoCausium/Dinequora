# Agregação financeira no banco (M2, migration 0031)

## O que muda

- **`ledger_day_totals(_org_id, _location_ids, _days, _same_time_yesterday)`** devolve, numa única
  instrução (um snapshot MVCC), os totais por loja × dia local × tipo de lançamento do período, além
  de "ontem até a mesma hora local". O retorno é um único `jsonb`, então o `max-rows` (1.000) do
  PostgREST não corta o resultado.
- **Nenhum total é armazenado.** Cada leitura agrega o próprio `finance_entries`, de modo que os
  números são idênticos ao ledger por construção. Lançamentos retroativos, exclusões e mudança de
  fuso aparecem na leitura seguinte, sem manutenção.
- **`SECURITY INVOKER`:** a RLS de `finance_entries` e de `locations` continua decidindo o que cada
  usuário vê.
- **Dias locais:** cada loja usa o próprio fuso (`locations.timezone`), com horário de verão.
  Janelas e "hoje" são calculados no SQL e o app apenas exibe.
- O app (`fetchLedgerSummary` → `readLedgerSummaryAggregated`) usa a função. **Somente** quando ela
  não existe (`PGRST202`/`42883`), volta ao leitor paginado da Onda 0. Qualquer outro erro é
  lançado. A exportação (`fetchLedgerRows`) continua paginada, por ser uma listagem linha a linha.

## Mudança de fuso de uma loja

Alterar `locations.timezone` **reorganiza todo o histórico da loja** nos dias do fuso novo: um
lançamento das 23h30 em Nova York pode passar para o dia seguinte em outro fuso. Nada é perdido nem
duplicado, e o comportamento é o mesmo do leitor anterior (testado). Antes de mudar o fuso de uma
loja em operação, avise que relatórios de dias passados podem mudar de dia.

## Política `finance_read` reescrita (mesmas regras, avaliadas uma vez por consulta)

A política anterior chamava `is_org_member()` e `can_access_location()` (funções
`SECURITY DEFINER`, que o planejador não incorpora à consulta) **para cada linha**, a cerca de
60 µs por linha. Com 1 milhão de lançamentos, isso dava 68 s, acima do `statement_timeout` de 8 s.

A política nova aplica as mesmas regras uma única vez por consulta:

| Antes (0019) | Agora (0031) |
|---|---|
| `is_org_member(org_id)` | implícito: `orgs_with_any_permission` só devolve organizações das quais o usuário é membro |
| `can_access_location(location_id)` | `location_id in (select accessible_location_ids())`, com exatamente o mesmo predicado (owner, ou acesso explícito à loja) |
| `org_id in (select orgs_with_any_permission(finance.view, dashboard.financials, reports.view))` | igual |

**Equivalência provada** em `src/test/integration/finance-rls-equivalence.db.test.ts`, com duas
organizações (4 e 2 lojas) e 13 identidades. Para cada uma, três conjuntos de lançamentos são
idênticos: a regra pretendida, escrita no teste e independente das duas políticas; a política
anterior, avaliada com a identidade; e o que a identidade lê pela RLS nova.

Identidades cobertas:
- owner;
- manager com 1 loja, com todas, e com `finance.view`, `dashboard.financials` e `reports.view`
  revogadas;
- staff sem permissão financeira, e staff com `finance.view`, `reports.view` ou
  `dashboard.financials`;
- staff com permissão financeira mas sem loja;
- membro das duas organizações;
- owner do outro tenant;
- platform admin;
- não membro.

Testes negativos:
- nenhuma linha de loja não acessível ou de outra organização, nem por leitura direta, nem por
  `ledger_day_totals` com IDs de loja forçados (inclusive lojas de outro tenant sob o ID da própria
  organização);
- nem o owner consegue INSERT, UPDATE ou DELETE direto no ledger.

Também verificados:
- `accessible_location_ids()` = `can_access_location()` para todas as identidades e lojas;
- o helper é `SECURITY DEFINER`, `STABLE`, com `search_path=public` e execução só para
  `authenticated` (sem `anon`, sem `PUBLIC`);
- `ledger_day_totals` é `SECURITY INVOKER`.

O teste anterior (9 perfis reais do tenant QA, em `ledger-aggregate.db.test.ts`) continua valendo.

## Desempenho (stack local descartável, 1.000.000 de lançamentos, 4 lojas, RLS ativa)

| Período | Antes da M2 (RLS por linha) | Agora |
|---|---|---|
| Histórico inteiro | 67,8 s (timeout) | 1,9 s |
| 60 dias | 57,7 s (timeout) | 148 ms |
| 7 dias | n/a | 26 ms |
| Hoje + ontem | n/a | 11 ms |

- **Concorrência:** 16 leitores mais 1 escritor simultâneos, 0 erros. O p95 foi de 659 ms em
  60 dias e de 4,0 s no histórico inteiro.
- **Índice de cobertura** (`INCLUDE (kind, amount_cents)`): ganho de 15–20%, custo de escrita
  dobrado. **Não foi criado**, porque os alvos são atingidos com o índice existente
  `finance_store_date`, usado com uma busca por faixa por loja.

Evidências completas em `C:\dev\Servora-backups\dinequora-m2-pending-design-20261117\`.

## Ordem de rollout

O app primeiro, porque funciona com e sem a função. Depois a migration. Em qualquer ordem o
resultado está correto.

**Aplique com `lock_timeout` curto** (por exemplo `PGOPTIONS='-c lock_timeout=5s'`), num horário de
pouco movimento, e repita se o tempo esgotar. Motivo: o `ALTER POLICY` precisa de um lock exclusivo
em `finance_entries`. No ensaio com 1.000.000 de linhas, ele esperou 56,6 s na fila atrás de uma
leitura que ainda usava a política antiga (lenta), e durante a espera também segurou novas leituras.
Com `lock_timeout` curto, ele desiste em vez de enfileirar.

## Rollback

Uma migration **nova**, nesta ordem e **nunca** com `DROP ... CASCADE`. O `CASCADE` removeria
também a política que depende de `accessible_location_ids`, deixando o ledger ilegível; isso foi
observado num ensaio no stack descartável.

1. `alter policy finance_read` de volta à expressão anterior (registrada em comentário na 0031);
2. `drop function ledger_day_totals(uuid, uuid[], integer, boolean)`;
3. `drop function accessible_location_ids()`.

O app detecta a função ausente e volta ao leitor paginado.

**Ensaiado** no stack descartável (`dq-m2-1`), com leitores concorrentes (owner, RLS ativa)
durante todo o processo:
- **sem volume:** 842 leituras diretas sem erro e sem contagem divergente; a função respondeu
  "não existe" só durante a janela de rollback, e zero outros erros;
- **com 1.000.000 de lançamentos:** rollback em 89 ms; o checksum de todas as linhas do ledger, de
  lojas, membros e acessos foi idêntico antes, durante e depois (**a migration é aditiva**, não
  altera dados); zero erros de leitura.

Script: `tools/rehearse-0031.mjs`, em
`C:\dev\Servora-backups\dinequora-m2-pending-design-20261117\`.

## Testes

- `src/test/integration/finance-rls-equivalence.db.test.ts` (`QA_M2_DB=1`): equivalência da
  política, testes negativos e atributos de segurança dos helpers (acima).
- `src/test/integration/ledger-aggregate.db.test.ts` (`QA_M2_DB=1`, stack descartável):
  - SQL = função = leitor paginado de 999 a 100.000 linhas, e função = SQL com 1.000.000;
  - DST (início e fim) em 4 fusos;
  - períodos e comparações;
  - lançamentos retroativos;
  - mudança de fuso;
  - transação não confirmada;
  - RLS por papel e equivalência da política;
  - `anon` sem acesso.
- `src/test/ledger-aggregate.test.ts`: mapeamento, fallback apenas para função inexistente e erros
  lançados.
