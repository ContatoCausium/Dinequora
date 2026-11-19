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
     (`pos.pending_sale_resolved`: responsável, loja, chave, horário, valor, tentativas) ⇒
     `resolved`. Desde a 0035, a justificativa vai só para o armazenamento privado
     `pos_pending_resolution_reasons`, e a auditoria guarda `reason_id` e `reason_length`;
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
| Staff | **nunca**: fora do teto do papel (`role_ceiling`). Desde a 0033 a concessão nem é gravada: `permission_outside_role` para qualquer autor, owner inclusive |
| Platform admin | sem acesso automático (não é membro da organização) |

Quem concede (0033, [member-grant-integrity.md](member-grant-integrity.md)): o owner, a qualquer
manager; um manager só concede a staff o que ele mesmo tem, e staff não pode tê-la, então na prática
**só o owner concede `orders.resolve_pending`** (a regra "managers só gerenciam staff das suas lojas"
foi preservada, o que vale também para o administrador da organização).

Não reaproveita `orders.refund`. Aparece na matriz de permissões da equipe como "Resolver vendas
pendentes".

## Riscos

| Risco | Mitigação |
|---|---|
| Alterar `create_pos_sale_v2` (caminho crítico) | O corpo da 0025 é copiado literalmente, mais **uma** linha (teste de arquivo `pos-pending-resolution-migration.test.ts`); privilégios preservados (teste de integração); suítes de POS e idempotência |
| Corrida venda × resolução | Mesmo lock; `scripts/security/pos_pending_resolution_race.mjs` (passo 5g da suíte) prova as duas ordens, com COMMIT e ROLLBACK, e a espera por `pg_blocking_pids` |
| Transação em REPEATABLE READ / SERIALIZABLE (H1) | O snapshot dessas transações nasce na primeira instrução, **antes** do lock da chave: a resolução não veria uma venda gravada nesse meio-tempo (e encerraria a chave), e a venda não veria um encerramento (e gravaria sob chave encerrada). Desde a 0033 as duas funções só rodam em READ COMMITTED (o padrão da API) e recusam os outros níveis com `isolation_unsupported`, sem gravar nada; o caixa mantém a venda pendente. Passo 5g: as duas ordens nos três níveis |
| Justificativa só com espaços invisíveis (B4) | Desde a 0033 o banco remove nas pontas espaços e caracteres invisíveis de todo tipo (tab, quebra de linha, espaço sem quebra, larguras zero, marcas de direção, hífen suave, preenchimentos, seletores de variação) e exige 10–500 caracteres com **pelo menos 5 letras ou dígitos**, de qualquer escrita. Grava o texto aparado. O servidor (zod `.trim()`) já recusava o texto só de espaços |
| Organização suspensa ou sem assinatura | Desde a 0033 a resolução chama `assert_org_operational` (`org_suspended` / `subscription_inactive`) e não grava nada |
| Chave de uma venda de outra loja | Desde a 0033, se a chave tem pedido **ou já foi encerrada** em outra loja da organização, a resolução recusa (`location_forbidden`) sem revelar nada nem auditar. Resta, por desenho, que alguém com a permissão numa loja encerre uma chave ainda sem pedido que pertença a outra loja: exige conhecer a chave (`pos-<uuid>`, gerada no caixa) |
| Encerrar uma venda que de fato foi paga | Permissão própria, verificação prévia, justificativa, confirmação explícita, auditoria. **Irreversível por desenho**: um "desfazer" reabriria o risco de duplicidade |
| A justificativa pode conter dados pessoais | Desde a 0035, o texto fica só num armazenamento privado e é legível apenas pelo Owner, pelo Admin da organização e por managers com `orders.resolve_pending` na loja, pela RPC `list_pending_sale_reasons`. A auditoria guarda os campos estruturados, sem o texto ([pending-reason-privacy.md](pending-reason-privacy.md)). Retenção: proposta em [pending-reason-retention.md](pending-reason-retention.md), nada implementado |
| Venda pendente só no navegador do caixa | Resolução restrita ao caixa original nesta etapa (decisão aprovada) |

## Ordem de rollout

Qualquer ordem é segura. Sem chaves encerradas, a venda funciona exatamente como antes, e o app
antigo nunca chama a RPC. Recomendado: migration e app juntos. O app novo só oferece o botão a quem
tem a permissão, que só existe depois da migration.

## Rollback

Procedimento único, gerado das próprias migrations e ensaiado (aplicação → rollback → reaplicação):
[`m2-rollback/README.md`](m2-rollback/README.md). Para a 0032 e a parte de POS da 0033, uma
migration **nova** que:

1. **mantém** `create_pos_sale_v2` como a 0033 deixou e mantém `pos_sale_key_voids`. Uma chave
   encerrada continua recusando venda durante a janela de rollback, porque o caixa que guardava
   aquela venda pendente pode reenviá-la a qualquer momento, e a venda já foi acertada por outro
   meio. Voltar ao corpo da 0025 a gravaria em duplicidade. Esta é a correção da revisão
   independente: o rascunho anterior voltava à 0025;
2. remove `resolve_pending_pos_sale`;
3. **mantém** o histórico e a auditoria dos encerramentos;
4. restaura `permission_catalog`, `role_ceiling` e `role_default_permissions` (0020/0018);
5. tira a permissão de **todos** os perfis, de sistema **e personalizados**, e de todas as concessões
   individuais, com auditoria, e recalcula as `effective_permissions`. Correção de 2026-11-19: antes
   só o `org_admin` era limpo, e um perfil personalizado guardaria a permissão, reativada sem aviso
   numa reaplicação;
6. **mantém** as revogações explícitas (`revoked_permissions`). Revogar só restringe, e perdê-las
   devolveria a permissão a um administrador da organização numa reaplicação. Desde a 0033,
   `set_member_access` também preserva revogações de permissões fora do catálogo quando o membro é
   editado na janela de rollback.

O POS volta ao comportamento da Onda 0, a pendência sem encerramento manual, mas as chaves já
encerradas continuam encerradas.

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
