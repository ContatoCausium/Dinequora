# Migrations órfãs (preservadas, nunca executáveis)

Decisão do responsável (2026-11-09): **preservar os três arquivos** onde estão, sem apagar, mover
ou adicionar ao journal. Eles estão publicados em `origin/main` desde outubro de 2026.

## Quais são

| Arquivo                                                       | Commit de origem       | O que contém                                                                            |
| ------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `drizzle/migrations/0010_fix_admin_list_platform_admins.sql`  | `660754d` (2026-10-26) | Recria `admin_list_platform_admins()` (correção do erro 42P13)                          |
| `drizzle/migrations/0011_create_pos_sale_and_idempotency.sql` | `f570a98` (2026-10-27) | Índice único `orders_org_client_order_id_uniq` + versão **antiga** de `create_pos_sale` |
| `drizzle/migrations/0012_enable_realtime_orders.sql`          | `d5fb48b` (2026-10-27) | Inclui `orders` e `order_items` na publicação `supabase_realtime`                       |

## Por que estão fora da sequência executável

O Drizzle aplica **somente** as entradas de `meta/_journal.json`. Esses arquivos foram criados
antes da reconstrução do backend e nunca entraram no journal; os números 0010–0012 do journal
pertencem a `0010_servora_types`, `0011_fix_admin_list_platform_admins` e
`0012_reconstructed_operational_schema`. Quando a reconstrução foi feita, o conteúdo útil das órfãs
foi incorporado a migrations do journal (abaixo). A reconstrução do zero **sem** elas produz esquema
idêntico ao da demonstração (verificado em 2026-11-08/09).

## O que já cobre cada uma

| Órfã                                   | Coberta por                                                                                                            | Observação                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `0010_fix_admin_list_platform_admins`  | `0011_fix_admin_list_platform_admins` (journal)                                                                        | Mesmo SQL; difere só em comentários        |
| `0011_create_pos_sale_and_idempotency` | `0013_reconstructed_pos_transactions` (índice + RPC) e `0018_member_permissions` (RPC com escopo de loja e permissões) | Cópia também em `docs/pending-migrations/` |
| `0012_enable_realtime_orders`          | `0017_idempotence_and_realtime_repair`                                                                                 | Cópia também em `docs/pending-migrations/` |

## Perigo concreto

`0011_create_pos_sale_and_idempotency.sql` define `create_pos_sale` com a **mesma assinatura** da
versão atual, como `SECURITY DEFINER` e **sem** checagem de membro, loja ou permissão. Executá-la à
mão (`psql -f`, editor SQL do Supabase) **substitui silenciosamente** a função segura: qualquer
usuário autenticado poderia criar pedidos em qualquer organização. Isso foi reproduzido num banco
descartável em 2026-11-09.

## Como evitar aplicação acidental

1. **Nunca** executar arquivos de `drizzle/migrations/` à mão; aplicar sempre com `drizzle-kit migrate`, que só lê o journal.
2. `scripts/qa/check-migrations.mjs` (CI, job `quality` e `security`):
   - falha se surgir qualquer `.sql` fora do journal que não seja uma destas três, ou se uma delas sumir;
   - com `DB_URL`: falha se o hash de uma órfã aparecer em `drizzle.__drizzle_migrations`;
   - com `DB_URL`: falha se `create_pos_sale` (e outras 12 RPCs de PDV, pedidos, estoque, compras e equipe) perder a checagem de permissão ou ganhar uma segunda definição — pega exatamente o rebaixamento descrito acima.
3. Antes de qualquer aplicação em ambiente hospedado, rodar `check-migrations` com `DB_URL` desse ambiente (somente leitura).
4. Não adicionar as órfãs ao journal: não há justificativa técnica (o conteúdo já está nas migrations 0011/0013/0017/0018) e a `0011` regrediria a segurança.
