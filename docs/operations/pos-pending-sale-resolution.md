# Resolução manual segura de venda pendente (migration 0032)

## Contexto

Desde a Onda 0, o POS mantém uma venda **pendente** quando não consegue confirmá-la (resposta
perdida, timeout, recarga da página). Ela nunca é descartada automaticamente: só sai do estado
pendente por "Verificar de novo" ou "Enviar de novo com segurança", sempre com a mesma chave de
idempotência. A 0032 acrescenta um terceiro caminho, **manual, autorizado e definitivo**.

## Como funciona

1. No diálogo da venda pendente, quem tem `orders.resolve_pending` vê "Encerrar esta venda
   manualmente…". Quem não tem a permissão vê uma explicação. A ação existe só **no caixa
   original**, porque a venda pendente fica no navegador dele; não há resolução remota.
2. O POS **verifica a chave primeiro**:
   - venda encontrada ⇒ recibo;
   - chave já encerrada ⇒ a comanda é liberada;
   - verificação falhou ⇒ nada é oferecido e a venda continua pendente.
3. Só com "não encontrada" abre a confirmação, que mostra valor, código completo, tentativas e
   horário da última tentativa. Ela exige **justificativa** (10 a 500 caracteres) e a confirmação
   explícita de que o valor não foi recebido ou foi devolvido.
4. O banco decide, dentro de `resolve_pending_pos_sale`:
   - toma **o mesmo advisory lock** da venda:
     `pg_advisory_xact_lock(hashtextextended(org_id || ':' || trim(chave), 0))`;
   - **se o pedido existe** ⇒ `recorded`: nada é encerrado, o POS mostra o recibo e a recuperação
     fica auditada (`pos.pending_sale_recovered`);
   - **se não existe** ⇒ grava a chave em `pos_sale_key_voids` e audita
     (`pos.pending_sale_resolved`: responsável, loja, chave, horário, justificativa, valor,
     tentativas) ⇒ `resolved`;
   - chave já encerrada ⇒ `already_resolved` (idempotente, sem nova auditoria).
5. `create_pos_sale_v2` passa a recusar uma chave encerrada (`sale_key_voided`), sob o mesmo lock
   e depois da checagem de pedido existente. **Nenhuma requisição atrasada consegue registrar a
   venda depois do encerramento.**
6. Qualquer erro, timeout ou incerteza ⇒ **a venda continua pendente** e nada é gravado.
7. Depois do encerramento, a comanda é liberada **sem a chave antiga**. Cobrar de novo é uma venda
   nova, com chave nova, e só deve ser feito se o cliente ainda quiser.

## Permissão `orders.resolve_pending`

| Papel | Acesso |
|---|---|
| Owner | sempre (o owner tem o catálogo inteiro) |
| Administrador da organização (perfil de sistema `org_admin`) | sim |
| Manager | **não por padrão**; pode recebê-la explicitamente (perfil ou permissão extra), sempre limitada às lojas a que tem acesso |
| Staff | **nunca**: fora do teto do papel (`role_ceiling`), então nem perfil nem permissão extra concedem |
| Platform admin | sem acesso automático (não é membro da organização) |

Não reaproveita `orders.refund`. Aparece na matriz de permissões da equipe como "Resolver vendas
pendentes".

## Riscos

| Risco | Mitigação |
|---|---|
| Alterar `create_pos_sale_v2` (caminho crítico) | O corpo da 0025 é copiado literalmente, mais **uma** linha (teste de arquivo `pos-pending-resolution-migration.test.ts`); privilégios preservados (teste de integração); suítes de POS e idempotência |
| Corrida venda × resolução | Mesmo lock; `scripts/security/pos_pending_resolution_race.mjs` (passo 5g da suíte) prova as duas ordens, com COMMIT e ROLLBACK, e a espera por `pg_blocking_pids` |
| Encerrar uma venda que de fato foi paga | Permissão própria, verificação prévia, justificativa, confirmação explícita, auditoria. **Irreversível por desenho**: um "desfazer" reabriria o risco de duplicidade |
| A justificativa pode conter dados pessoais | Texto livre de no máximo 500 caracteres, visível a quem lê o log de atividades; orientar a equipe |
| Venda pendente só no navegador do caixa | Resolução restrita ao caixa original nesta etapa (decisão aprovada) |

## Ordem de rollout

Qualquer ordem é segura. Sem chaves encerradas, a venda funciona exatamente como antes, e o app
antigo nunca chama a RPC. Recomendado: migration e app juntos. O app novo só oferece o botão a quem
tem a permissão, que só existe depois da migration.

## Rollback

Uma migration **nova**:

1. recria `create_pos_sale_v2` com o corpo da 0025;
2. remove `resolve_pending_pos_sale`;
3. **mantém** `pos_sale_key_voids` (histórico e auditoria);
4. restaura `permission_catalog`, `role_ceiling` e `role_default_permissions` (0020/0018);
5. tira a permissão do perfil `org_admin` e recalcula as `effective_permissions`.

O POS volta ao comportamento da Onda 0: pendência sem encerramento manual.

## Testes

- `src/test/integration/pos-pending-resolution.db.test.ts` (`QA_PENDING_DB=1`, stack descartável):
  - recuperação sem encerrar;
  - encerramento com auditoria completa;
  - venda tardia recusada;
  - idempotência;
  - matriz de permissões completa;
  - validações sem gravação;
  - RLS de `pos_sale_key_voids`, sem escrita direta;
  - função de venda com os mesmos privilégios.
- `scripts/security/pos_pending_resolution_race.mjs`: 20 verificações com duas sessões reais.
- `src/test/pos-pending-sale.test.tsx`:
  - botão só com a permissão;
  - verificação antes de oferecer;
  - justificativa e confirmação obrigatórias;
  - `recorded` ⇒ recibo;
  - erro ou timeout ⇒ pendente;
  - verificação falha ⇒ nada é oferecido;
  - `sale_key_voided` ⇒ comanda liberada;
  - reload com chave encerrada.
- `src/test/permissions.test.ts`: paridade do catálogo com a 0032 e matriz por papel.
