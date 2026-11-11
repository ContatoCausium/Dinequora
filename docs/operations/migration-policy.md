# Política de migrations — SQL First

Status: **em vigor** a partir da Fase 1.0. Aplicada automaticamente por
`scripts/qa/check-migrations.mjs` (job `quality` em modo arquivos; job `security` também contra o
banco recém-criado).

## Modelo

- O esquema do banco é definido **somente** pelas migrations SQL escritas à mão em
  `drizzle/migrations/`, aplicadas por `drizzle-kit migrate` na ordem de `meta/_journal.json`.
- O Drizzle é apenas o **executor**: `drizzle/schema.ts` fica em branco e os snapshots em `meta/`
  são vazios (0 tabelas). Isso é intencional — não é dívida técnica nem pendência.
- **Proibido** `drizzle-kit generate` (ou `push`/`introspect` contra qualquer banco compartilhado):
  com um esquema em branco, ele produziria migrations vazias ou destrutivas. A CI falha se
  `schema.ts` deixar de estar em branco ou se algum snapshot passar a descrever tabelas, enums,
  esquemas, sequências, views, papéis ou políticas.
- Snapshots para 0017 em diante **não** serão criados: não há esquema a registrar.
- `drizzle-kit` e `drizzle-orm` ficam em versão **exata** no `package.json`, igual ao
  `package-lock.json`, para que o executor nunca mude sem uma revisão explícita.

## Histórico imutável

- Uma migration que entrou no journal **nunca é editada, renomeada nem removida**. Correções são
  sempre uma migration nova.
- `scripts/qa/migration-hashes.json` registra o SHA-256 (fim de linha normalizado para LF) de cada
  migration do journal e das três órfãs conhecidas. Foi gerado a partir de `main` e conferido
  contra o registro de migrations aplicadas na demonstração (21 de 21, na mesma ordem).
- A CI falha se um arquivo deixar de bater com o hash registrado, se uma entrada do journal não
  tiver hash ou se o manifesto citar algo que não está no journal.
- As três órfãs (`0010_fix_admin_list_platform_admins`, `0011_create_pos_sale_and_idempotency`,
  `0012_enable_realtime_orders`) continuam preservadas e nunca executáveis
  (`docs/operations/migration-orphans.md`).

## Como criar uma migration nova

1. Próximo número livre, nome descritivo em inglês: `NNNN_descricao_curta.sql`.
2. Acrescentar a entrada no fim de `meta/_journal.json` (`idx` seguinte, `when` maior que o
   anterior, mesmo formato das existentes).
3. Registrar o hash: `node scripts/qa/check-migrations.mjs --add-new-hashes` (só acrescenta; nunca
   reescreve um hash existente).
4. Regenerar `src/integrations/supabase/types.ts` no mesmo commit, **sempre pelo script** e só
   contra uma stack local criada do zero:
   `supabase start --workdir scripts/qa ...`, aplicar as migrations
   (`LOVABLE_DB_MIGRATION_URL=<url local> npx drizzle-kit migrate`) e
   `bash scripts/qa/gen-types.sh`. O script recusa uma CLI diferente da fixada na CI
   (`supabase/setup-cli`, hoje 3.0.0) e qualquer banco que não seja local; gera só o esquema
   `public` e aplica apenas o Prettier do repositório (formatação; nomes, opcionalidade e
   nulabilidade não mudam). Nunca editar o arquivo à mão nem usar `--remote`, `--linked` ou
   `--project-id`. A CI (job `security`, passo "Generated types match the migrations") roda
   `bash scripts/qa/gen-types.sh --check` depois de aplicar as migrations do zero e falha se o
   arquivo versionado divergir. Ao atualizar a versão da CLI na CI, regenerar os tipos no mesmo PR.
5. Testar num banco descartável: aplicar do zero (`scripts/qa/security-suite.sh`) e, se houver
   dados afetados, ensaiar a atualização numa cópia restaurada da demonstração (nunca na própria
   demonstração e nunca na CI, porque o dump contém dados de usuários).

## Regras de conteúdo

- **Aditiva por padrão**: colunas novas nulas ou com padrão seguro; constraints novas com
  `NOT VALID` seguido de `VALIDATE CONSTRAINT` quando houver dados; remoção de coluna/constraint só
  depois de uma versão inteira sem uso.
- Mudança de assinatura de RPC → função nova (`_v2`); a antiga permanece até uma remoção planejada.
- Toda tabela em `public` com **RLS habilitado** e políticas explícitas (a CI falha sem RLS).
- Toda função `SECURITY DEFINER` com `SET search_path` fixo (a CI falha sem ele).
- Nenhuma função `SECURITY DEFINER` que grava dados pode ser executável por `anon`.
- Toda função `SECURITY DEFINER` que grava dados e é executável por `authenticated` precisa estar
  classificada em `check-migrations.mjs`:
  - `GUARDED` — usa o catálogo de permissões (`assert_permission`/`has_permission`/
    `has_any_permission`); é a opção padrão para RPCs novas;
  - `REVIEWED` — autoriza por outro mecanismo (dono da organização, admin da plataforma, próprio
    usuário), com o motivo registrado. Entrar nesta lista exige revisão explícita.
    Uma função nova sem classificação faz a CI falhar (falha fechada).
- `GRANT`/`REVOKE` explícitos em toda função nova.
- **PL/pgSQL sem nomes ambíguos**: variáveis e parâmetros sempre com prefixo `_` (`_product`,
  `_category_id`), toda coluna qualificada pelo alias da tabela (`mp.category_id`) e nenhum alias
  igual ao nome de uma variável. O PL/pgSQL não distingue uma variável de uma coluna ou alias com o
  mesmo nome e a função falha só quando o trecho é executado (`42702 ... is ambiguous`), não ao ser
  criada: foi o que quebrou o arquivamento de categorias de 0013 a 0025 (corrigido em 0026). Todo
  ramo de uma função nova ou alterada precisa ser executado por uma fixture em
  `scripts/security/`.
  - Exceção que o próprio PostgreSQL impõe: as colunas de destino de `SET` em `UPDATE` (e em
    `ON CONFLICT ... DO UPDATE SET`) e a lista de colunas de `INSERT INTO t (a, b)` **não aceitam**
    o alias. `UPDATE public.menu_categories mc SET mc.active = false` falha com `42703` (o
    PostgreSQL lê `mc.active` como o campo `active` de uma coluna `mc`) e `INSERT INTO t x (x.a)`
    com `42601`. Essas posições sempre designam colunas da tabela alvo e nunca são trocadas por uma
    variável, então não ficam ambíguas mesmo que exista uma variável com o mesmo nome: escrever
    `SET active = false` e qualificar todo o resto (`WHERE mc.id = _category_id`). O lado direito
    do `SET`, o `WHERE` e o `RETURNING` seguem a regra geral (lá uma coluna sem alias com o nome de
    uma variável dá `42702`).
- Nunca dados de demonstração ou de cliente em migrations estruturais; seeds ficam em
  `scripts/seeds/` (`docs/operations/data-layers-and-marao-production.md`).

## Histórico do QA local

O stack de QA local `dq-rebuild` foi montado a partir de um checkout com fim de linha CRLF, antes do
`.gitattributes`: as linhas 0010–0017 do seu registro de migrations tinham o hash da versão CRLF dos
mesmos arquivos (conteúdo idêntico) e `check-migrations` com `DB_URL` desse stack acusava
`applied hash differs`. Em 2026-11-11 os oito hashes foram corrigidos para os do manifesto (só a
coluna `hash`, numa transação com pré e pós-condições, depois de um backup restaurado e conferido e
de um ensaio numa cópia). O registro do `dq-rebuild` agora confere com o manifesto.
