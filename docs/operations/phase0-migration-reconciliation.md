# Fase 0 — Plano de reconciliação das migrations

Status: **decisões tomadas em 2026-11-09** (abaixo). Nenhuma migration foi reescrita, renomeada, movida ou apagada.

- §3.1 `.gitattributes`: **aplicado** (commit `5dd0b2f`); 32 arquivos CRLF convertidos só no fim de linha; `git ls-files --eol` = `i/lf w/lf` em todos os textos; um banco reconstruído a partir deste checkout Windows agora registra os mesmos hashes da demo.
- §3.2 Órfãs: **preservadas** por decisão do responsável; ver `migration-orphans.md` (inclui o risco da `0011_create_pos_sale` e a proteção na CI).
- §3.4 MARAO: **continua demo**. Separação de camadas e a proposta `0021` testadas em banco descartável: ver `data-layers-and-marao-production.md`.
  Data da investigação: 2026-11-09. Evidências reproduzíveis com `scripts/qa/check-migrations.mjs` e
  `scripts/qa/security-suite.sh`.

## 1. Estado verificado

| Item                                               | Situação                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Journal (`drizzle/migrations/meta/_journal.json`)  | 21 entradas, `0000` a `0020`, `idx` sequencial, `when` crescente, sem número duplicado **dentro do journal**                                                                                                                                                                         |
| Arquivos `.sql`                                    | 24: as 21 do journal + 3 órfãs                                                                                                                                                                                                                                                       |
| Banco da demonstração (54321)                      | 21 linhas em `drizzle.__drizzle_migrations`; hashes iguais aos arquivos normalizados em LF (`check-migrations` com `DB_URL`: PASS). As linhas de 0018, 0019 e 0020 foram registradas em 2026-11-08 sem reaplicar SQL (decisão mantida pelo responsável em 2026-11-09)                |
| Reconstrução do zero (`dq-rebuild`, banco isolado) | As 21 aplicam sem erro; esquema `public` e privilégios idênticos aos da demonstração (diff vazio); 85 funções, 32 políticas, 13 triggers, mesmos planos, mesma publicação Realtime e mesmos perfis do sistema                                                                        |
| Ensaio da CI (stack novo, checkout LF)             | migrations → integridade → fixtures SQL → tenant de QA → matriz 144/144: PASS                                                                                                                                                                                                        |
| Publicação                                         | `0000`–`0009` e as 3 órfãs estão em `origin/main`; `0010`–`0017` estão em `origin/integration/local-servora-2026`; `0018`–`0020` são **locais** (não commitadas). O backend Lovable registra `0000`–`0010` aplicadas (ledger); o estado do Supabase hospedado **não foi consultado** |

### 1.1 Numeração duplicada (somente fora do journal)

| Número | No journal                              | Órfã (fora do journal)                 | Conteúdo da órfã                                                 | Coberta por                                                                 |
| ------ | --------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0010   | `0010_servora_types`                    | `0010_fix_admin_list_platform_admins`  | correção da função `admin_list_platform_admins`                  | `0011_fix_admin_list_platform_admins` (mesmo SQL; difere só em comentários) |
| 0011   | `0011_fix_admin_list_platform_admins`   | `0011_create_pos_sale_and_idempotency` | índice `orders_org_client_order_id_uniq` + RPC `create_pos_sale` | `0013_reconstructed_pos_transactions` (e `0018` redefine `create_pos_sale`) |
| 0012   | `0012_reconstructed_operational_schema` | `0012_enable_realtime_orders`          | `orders`/`order_items` na publicação `supabase_realtime`         | `0017_idempotence_and_realtime_repair`                                      |

O Drizzle aplica apenas o que está no journal; as órfãs **nunca são executadas**. A reconstrução sem
elas resulta em esquema idêntico ao da demonstração, o que comprova que estão superadas.
As duas últimas também têm cópia em `docs/pending-migrations/`.

### 1.2 Snapshots

`meta/0000_snapshot.json` a `0016_snapshot.json` existem e estão encadeados (`id`/`prevId`), mas são
**vazios** (0 tabelas): `drizzle/schema.ts` é “intencionalmente em branco” e as migrations são SQL
escrito à mão. `drizzle-kit check` passa; `drizzle-kit generate` não detecta nada. Não há snapshots
para 0017–0020. `drizzle-kit migrate` não usa snapshots, então isso não afeta a aplicação.

### 1.3 Dependências

- Tabelas: cada uma é criada em uma única migration (0000, 0001, 0003, 0004, 0012, 0014, 0018). Nenhuma recriação.
- Funções: 85; 33 são redefinidas em mais de uma migration (ex.: `create_invitation`/`accept_invitation`
  0000→0003→0018; `save_operational_record` 0014→0018→0020; RPCs do PDV/KDS 0013→0018). A versão vigente
  é sempre a da migration mais recente; a ordem do journal é obrigatória.
- 0018 depende de 0012–0016 (tabelas operacionais) e introduz `permission_profiles`, `has_permission`,
  `assert_permission`; 0019 (índices de desempenho) e 0020 (`inventory.costs`, `inventory_item_costs`) dependem de 0018.
- `0000` insere as organizações **MARAO BURGERS** e **Harbor Taco Co.**; `0001` as marca `is_demo = true`.
  Todo banco novo (inclusive produção) nasce com essas duas organizações de demonstração. Ver §3.4.

### 1.4 Fim de linha (causa de hashes divergentes)

O repositório não tem `.gitattributes` e usa `core.autocrlf=true`. O índice do Git tem LF, mas no
disco 32 arquivos ficaram em CRLF, entre eles `0010`–`0017`. O Drizzle registra o SHA-256 do arquivo
**como está no disco**. Evidência medida:

- banco aplicado a partir de LF (demonstração, CI Linux): hashes iguais aos arquivos em LF;
- banco reconstruído a partir deste checkout Windows (`phase0_rt`): hashes de 0010–0017 são os do CRLF,
  e `check-migrations` acusa `applied hash differs` nessas 8.

O esquema resultante é o mesmo, mas o registro passa a depender da máquina que aplicou. A CI roda em
Linux (LF) e o `check-migrations` com `DB_URL` falha se um hash divergir.

## 2. O que não fazer

- Não renomear, mover nem editar `0000`–`0020` nem as órfãs publicadas em `main`.
- Não apagar linhas de `drizzle.__drizzle_migrations` em nenhum ambiente.
- Não executar `db reset`, `drizzle-kit push` ou `generate` contra a demonstração.
- Não acessar o Supabase hospedado nesta fase.

## 3. Plano proposto (cada passo exige aprovação)

### 3.1 Fim de linha — `.gitattributes` (sem efeito no conteúdo do índice)

```
* text=auto eol=lf
*.sql text eol=lf
*.webp binary
*.png binary
*.ico binary
```

Depois, `git add --renormalize .` (não deve mudar nenhum blob: o índice já é LF) e um novo checkout
dos 32 arquivos CRLF para LF. Verificação: `git diff --cached --stat` vazio para conteúdo; `check-migrations`
com `DB_URL` da demonstração continua PASS. Risco: nenhum para dados; elimina os 77 arquivos que aparecem
como modificados só por fim de linha.

### 3.2 Órfãs — manter e documentar (recomendado)

Mantê-las onde estão (já publicadas em `main`), registradas como órfãs conhecidas no
`check-migrations.mjs`, que falha se aparecer qualquer órfã nova ou se uma conhecida sumir.
Alternativa, só com aprovação explícita: mover as três para `docs/archived-migrations/` num commit
próprio, depois de confirmar que nenhum ambiente hospedado as executou manualmente.

### 3.3 Snapshots 0017–0020

Nenhuma ação necessária para aplicar migrations. Opcional: gerar snapshots vazios encadeados para
manter o padrão da ferramenta Lovable, num commit isolado. Recomendação: só se a ferramenta exigir.

### 3.4 Organizações de demonstração semeadas pela `0000`

Não editar a `0000`. Antes do primeiro ambiente comercial, decidir:
(a) manter MARAO e Harbor como demonstração (`is_demo = true`, estado atual); ou
(b) se MARAO for cliente real, uma **migration nova e aditiva** que faça `is_demo = false` apenas para
`org_marao` — exige aprovação, porque muda o que essa organização vê (passa a ver dados gravados).
Para produção, planejar uma migration aditiva que remova/arquive essas organizações **somente** quando
não tiverem membros nem dados.

### 3.5 Registro das 0018–0020 no Git

Commitar `0018`–`0020` + `_journal.json` num commit próprio (grupo “Migrations”, ver plano de
commits), com `check-migrations` PASS em LF. Nada vai para o remoto sem autorização.

### 3.6 Ambiente hospedado (fase posterior, com autorização)

Comparar `drizzle.__drizzle_migrations` do hospedado com o journal usando `check-migrations` em modo
somente leitura; aplicar o que faltar com `drizzle-kit migrate` após backup; nunca reescrever o registro.

## 4. Como verificar

```
node scripts/qa/check-migrations.mjs                                   # arquivos x journal
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/qa/check-migrations.mjs   # demonstração (leitura)
bash scripts/qa/security-suite.sh                                       # stack QA novo (CI)
```
