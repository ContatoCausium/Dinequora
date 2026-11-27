# Segurança do fluxo de venda do PDV (0025, 0032, 0033, 0036)

## O único caminho de venda

O app registra vendas só por duas RPCs, chamadas por funções de servidor
(`src/lib/operational.functions.ts`):

| RPC | Uso |
|---|---|
| `persist_finalized_pos_sale_atomic_v2` | Venda com pagamento: pedido, pagamento, baixa de estoque e lançamentos do ledger numa transação |
| `create_pos_sale_v2` | Pedido aberto, sem pagamento |

As duas terminam em `create_pos_sale_v2`, que faz, nesta ordem:
1. recusa transações fora de READ COMMITTED (`isolation_unsupported`, 0033);
2. confere escopo, loja, organização operacional e a permissão `pos.sell` na loja;
3. toma o advisory lock da chave (`org_id:chave`);
4. se a chave já tem pedido: devolve o mesmo pedido (payload igual) ou recusa (`idempotency_conflict`);
5. se a chave foi encerrada por `resolve_pending_pos_sale`: recusa (`sale_key_voided`, 0032);
6. calcula preço e imposto no servidor, com a alíquota da loja.

## As assinaturas antigas (aposentadas pela 0036)

`create_pos_sale`, `finalize_pos_sale_atomic` e `persist_finalized_pos_sale_atomic` são da época dos
pontos-base. Desde a 0025 são invólucros que validam os pontos-base e **delegam à v2**.

- **Nunca foram um contorno:** como delegam, herdam o lock, a idempotência, a recusa de chave
  encerrada e a de isolamento. Comprovado na 0035, antes da 0036: uma chave encerrada devolve
  `sale_key_voided` pelas três.
- **Nenhuma versão do app as chama:** `main`, o Worker publicado `55493d4` e esta branch chamam a v2
  desde o commit `10b2d94`. As chamadas saem de funções de servidor, então bundle de navegador em
  cache não entra na conta.
- **A 0036 revoga o `EXECUTE`** de `PUBLIC`, `anon`, `authenticated` e `service_role`. As funções
  continuam no banco, só com o dono. Assim o fluxo atual é o único ponto de entrada.
- **Rollback:** `security-closure/0036-rollback.sql` devolve o `EXECUTE` a `authenticated`.

Antes de aplicar a 0036 em qualquer ambiente, o build de servidor publicado ali precisa conter
`10b2d94`. O Client Preview e a `main` contêm.

## O que está comprovado, e por qual teste

| Garantia | Teste |
|---|---|
| Venda normal registra pedido, pagamento, ledger e auditoria (ator e loja) | `pos_sale_flow_integrity.mjs` N1–N3; matriz de permissões; `pos-idempotency.db.test.ts` |
| Resposta perdida: o reenvio devolve o mesmo pedido e não grava nada; a busca por chave o encontra | `pos_sale_flow_integrity.mjs` R1–R4; `pos-idempotency.db.test.ts` |
| Mesma chave com outro payload é recusada | R3; `pos-idempotency.db.test.ts` |
| Chave encerrada não é reutilizável por nenhuma entrada v2 | K1; `pos_pending_resolution_race.mjs`; `pos-pending-resolution.db.test.ts` |
| Chave com pedido nunca é encerrada | K2 |
| Duas requisições simultâneas resultam em um pedido (COMMIT e ROLLBACK) | C1; `pos_pending_resolution_race.mjs` |
| Dez envios simultâneos resultam em um pedido, um pagamento e um conjunto de lançamentos | C2; `pos-idempotency.db.test.ts` (dez envios pela API) |
| Funções antigas: recusadas para todo papel da API, sem gravar nada | L1, L2, L5; fixtures `reconstructed_operations.sql` e `store_sales_tax.sql`; matriz; `pos-idempotency.db.test.ts` |
| Funções antigas chamadas pelo dono ainda delegam: chave encerrada recusada, mesma idempotência | L3, L4 |
| Quem vende onde: owner em toda loja; admin, manager e caixa na própria loja; cozinha, outro tenant, admin da plataforma e `anon` nunca | P1, P2; matriz (170 verificações) |
| Outro tenant não lê nada da venda; ninguém grava pedidos, pagamentos, ledger, auditoria ou chaves encerradas diretamente | T1, T2; `finance-rls-equivalence.db.test.ts` |
| Permissões efetivas de cada papel inalteradas pela 0036 | Hash das permissões efetivas antes e depois; `api_privileges.mjs` (o manifesto só perde os três `EXECUTE`) |

Controle negativo: na 0035, `pos_sale_flow_integrity.mjs` falha exatamente nas 7 verificações das
funções antigas (L1, L2, L5) e passa nas outras 20.
