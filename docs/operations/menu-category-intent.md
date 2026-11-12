# Categorias do cardápio: intenção explícita (migration 0029)

Status: **proposta** na branch `fix/menu-category-integrity` (PR próprio). A migration **não foi
aplicada** em QA, demo ou produção.

## Problema (causa raiz)

Desde a 0018 (mantida por 0027 e 0028), o ramo de categoria de `save_operational_menu` era um único
upsert:

```sql
INSERT ... ON CONFLICT (org_id, client_id)
  DO UPDATE SET name, description, active = coalesce(payload.active, true)
```

O banco não sabia se a chamada era uma criação, uma edição ou uma reativação. Consequências:

- criar com um id existente sobrescrevia a categoria (e a reativava se estivesse arquivada);
- duas criações simultâneas do mesmo id: a segunda esperava o INSERT da primeira e virava UPDATE —
  sobrescrita silenciosa;
- uma edição que esperava um arquivamento concorrente reativava a categoria recém-arquivada;
- `"active"` no payload desativava/reativava pelo salvamento (a 0028 só recusava desativar uma
  categoria com produto ativo).

A validação do frontend (PR #20) reduz a chance, mas não resolve corridas entre sessões.

## Contrato (estrito)

Payload de categoria: `{"op": "create" | "update" | "reactivate", "id", "name", "description"?}`.

| Intenção     | Faz                                                                      | Recusa                                                                  |
| ------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `create`     | insere uma categoria **nova**, ativa                                     | id existente ativo → `category_exists`; arquivado → `category_archived` |
| `update`     | muda nome e descrição de uma categoria **ativa**; nunca toca em `active` | inexistente → `not_found`; arquivada → `category_archived`              |
| `reactivate` | reativa uma categoria **arquivada** (nome e descrição mantidos)          | inexistente → `not_found`; já ativa → `category_not_archived`           |

- Sem `op`, `op` desconhecido ou nulo, ou qualquer chave `"active"` → `invalid_menu`. Não sobra
  nenhum comportamento implícito.
- Desativar = só `archive_operational_menu` (0026), com `category_in_use`.
- Ordem das verificações inalterada: membro (`forbidden`), permissão `menu.edit`
  (`permission_denied` para staff), organização operacional, tamanho de id/nome (`invalid_menu`),
  só proprietário (`forbidden`), e só então a intenção.
- Toda recusa acontece antes de qualquer gravação e antes da auditoria: nenhuma mudança parcial,
  nenhuma linha de auditoria de sucesso.
- Sucesso grava uma linha `menu.saved` com `{"kind": "category", "op": ...}`. Produtos continuam
  com `{"kind": "product"}`.
- Produtos, arquivamento, leitura, RLS, permissões, assinatura da função, `SECURITY DEFINER`,
  `search_path` e grants: inalterados.

## Concorrência (READ COMMITTED)

- `create` × `create` (mesmo id): o segundo `INSERT ... ON CONFLICT DO NOTHING` espera o primeiro.
  Primeiro confirma → segundo recusado com `category_exists`. Primeiro desfeito → segundo cria.
- `update`/`reactivate` travam a linha da categoria `FOR UPDATE`, como o arquivamento. Quem espera
  relê a linha (EvalPlanQual) e decide pelo estado confirmado: uma edição atrás de um arquivamento é
  recusada com `category_archived`; uma edição atrás de uma reativação é aceita.
- Ordem de locks: um salvamento de categoria trava no máximo a própria linha e não lê produtos; um
  salvamento de produto trava o produto e lê a categoria `FOR SHARE`. Nenhum caminho segura a
  categoria esperando um produto: sem ciclo de deadlock e sem lock amplo.

## Consumidores mapeados

| Consumidor                                                                                                                                                                                    | Situação                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Tela Cardápio (`src/components/menu/menu-page.tsx`) via `saveOperationalMenu`                                                                                                                 | envia `op` (este PR)                                               |
| `scripts/qa/seed-qa-org.mjs`                                                                                                                                                                  | `op: "create"` (este PR)                                           |
| Fixtures/testes de segurança e integração (`scripts/security/*`, `src/test/integration/menu-archive.db.test.ts`)                                                                              | atualizados (este PR)                                              |
| `scripts/seeds/demo/seed-demo-orgs.sql`                                                                                                                                                       | não chama a RPC (insere direto); sem mudança                       |
| PDV e Estoque                                                                                                                                                                                 | só leem `fetchOperationalMenu`; sem mudança                        |
| **App de demo** (`Servora-ui`, branch `fix/customer-panel-polish`) e branches antigas (`feature/dinequora-customer-panel`, `security/pr2-foundation`, `db/0021-...`, `feat/demo-environment`) | código **antigo**, sem `op`: salvar categoria daria `invalid_menu` |

## Ordem segura de atualização

O cliente novo é **compatível com os dois bancos**: a função da 0028 ignora chaves desconhecidas no
payload, então `create`/`update`/`reactivate` caem no upsert antigo e funcionam como antes. Isso
elimina a janela de incompatibilidade, desde que a ordem seja respeitada:

1. **Atualizar o aplicativo primeiro**, em todo ambiente que vai receber a 0029 (QA, demo e, no
   futuro, produção). Builds antigos não podem continuar servindo esse banco.
2. **Depois aplicar a 0029** (com backup e ensaio, como nas etapas de QA anteriores).
3. Verificar: criar, editar, arquivar e reativar uma categoria pela tela; `menu.saved` com `op`.

Se a ordem for invertida (0029 antes do app), o app antigo recebe `invalid_menu` só ao **salvar
categorias**. Produtos, arquivamento, PDV, Estoque e leituras não são afetados, e nenhum dado é
gravado ou corrompido: a recusa acontece antes de qualquer escrita.

**Demo:** o app de demo atual (`Servora-ui`) é antigo e tem alterações não versionadas. Ele precisa
ser atualizado para o código da `main` antes de a demo receber 0021–0029 (pré-requisito que já
existia para 0021–0028).

## Rollback

- **Aplicativo:** voltar para uma versão anterior só é seguro enquanto o banco não tiver a 0029.
- **Banco:** não se reverte migration aplicada (histórico imutável). O rollback é uma migration nova
  que recria a função da 0028 (o corpo está no arquivo da 0028). O cliente novo continua funcionando
  com ela, porque a 0028 ignora `op`.
- Os dados não mudam de formato: a 0029 só troca a função, sem `ALTER TABLE` e sem backfill.

## Testes

- `scripts/security/menu_category_intent.sql` (suíte, passo 3): contrato sequencial, cada intenção e
  cada recusa sem mudança de dados ou auditoria, papéis, tenants, organização suspensa, auditoria
  com a intenção.
- `scripts/security/menu_category_deactivate.sql` (passo 3): o caminho da issue #18 fechado
  (`invalid_menu`), desativação só pelo arquivamento, reativação só explícita.
- `scripts/security/menu_category_deactivate_race.mjs` (passo 5e) e
  `scripts/security/menu_category_intent_race.mjs` (passo 5f): duas sessões PostgreSQL reais, nas
  duas ordens, com COMMIT e ROLLBACK, espera provada por `pg_blocking_pids`, auditoria exata.
- `src/test/menu-page.test.tsx`: a tela envia a intenção certa e explica cada recusa (en-US/pt-BR).
