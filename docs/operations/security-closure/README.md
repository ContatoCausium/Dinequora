# Rollback e reaplicação das migrations 0034 e 0035

Os arquivos desta pasta são **gerados** por `scripts/qa/build-m2-rollback.mjs` a partir das próprias
migrations. `src/test/security-closure-migrations.test.ts` falha se divergirem.

| Arquivo | O que faz |
|---|---|
| `0034-rollback.sql` | Volta `admin_assign_owner` ao corpo da 0001 e transforma as funções dos gatilhos `member_owner_serialize` e `platform_role_separation` em no-ops. Os gatilhos ficam, para não usar `DROP TRIGGER` (ACCESS EXCLUSIVE em `organization_members`). **Reabre a escalada que a 0034 fechou** |
| `0035-rollback.sql` | Volta `resolve_pending_pos_sale` ao corpo da 0033 **só se a função existir** (depois do rollback da M2 ela não volta), a policy da auditoria à 0019, e remove `list_pending_sale_reasons` e `audit_visible_location_ids`. **Mantém** o armazenamento privado com os textos e o privilégio por coluna das chaves encerradas. **Amplia o acesso** para eventos novos até a reaplicação (veja o WARNING do arquivo) |

Nenhum dos dois é migration. Num rollback real, cada um vira o conteúdo de uma migration **nova**
revisada, aplicada pelo runner normal numa transação. Por isso não têm BEGIN nem COMMIT, e começam
com `set local lock_timeout = '5s'`.

**Reaplicação:** rodar o arquivo da migration de novo, 0034 e/ou 0035. Todas as instruções são
idempotentes. A 0035 move para o armazenamento privado os textos que a função da 0033 tiver gravado
durante a janela.

## Quando usar

- **0035:** um problema funcional atribuível ao recorte por loja da auditoria ou à nova gravação.
  Nada volta a expor texto que já foi movido. As **novas** resoluções voltam a gravar o texto na
  chave encerrada (coluna ainda ilegível pela API) e na auditoria, legível por todo `team.activity`
  da organização (inclusive managers de outras lojas) e pelos admins da plataforma, até a
  reaplicação. O recorte por loja some para todos os eventos.
- **0034:** só se a regra nova impedir uma operação legítima e não houver alternativa. Reabre a
  possibilidade de um admin da plataforma assumir um tenant.

## Ordem

1. Banco primeiro. O app não depende das duas: as telas não usam a RPC nova, e os erros novos do
   Control Center só aparecem quando a regra recusa.
2. Rollback das duas: 0035 e depois 0034, na mesma transação. Para reaplicar: 0034 e depois 0035.
3. Rollback da M2 inteira (0031–0033), com [m2-rollback](../m2-rollback/README.md): o `rollback.sql`
   também remove `list_pending_sale_reasons`, e o `reapply.sql` roda a 0035 **depois** da 0033.
   Reaplicar só a 0033 traria de volta a função que grava o texto na chave e na auditoria.

## Ensaio (stack descartável apenas)

`scripts/security/security_closure_rollback.mjs`, passo 9 da suíte, depois do ensaio da M2:
1. aplica os dois rollbacks numa transação e confere os corpos anteriores e o que é mantido;
2. grava resoluções à moda da 0033 (resolvida, recuperada) e uma chave encerrada direta;
3. reaplica 0034 e 0035 numa transação e confere:
   - cada texto movido exatamente, vinculado ao seu evento e com `reason_length` certo;
   - nada sobrou e o movimento foi auditado;
   - funções, policies, gatilhos, privilégios e constraints idênticos ao estado inicial;
   - a chave continua recusando a venda;
   - a regra do Owner voltou;
4. roda a 0035 mais uma vez e confere que nada mudou;
5. rollback da M2 e depois o da 0035: a função de resolução não volta; a reaplicação da M2 termina
   exatamente no estado inicial.

Resultado local: 20/20.
