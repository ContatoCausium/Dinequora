# Modelos de privilégio: hospedado × CLI

O mesmo conjunto de migrations produz **privilégios diferentes** conforme os privilégios padrão do
banco onde roda. A suíte de segurança roda nos dois modelos; a publicação é validada no modelo
hospedado.

## Os dois modelos

| | **hosted** | **cli** |
|---|---|---|
| Onde existe | Projetos Supabase criados desde 2026: Client Preview (`jcbxayljyyhpbnzsduwb`) e produção | Stacks do `supabase start` (demo local, QA local) e projetos hospedados antigos |
| Privilégios padrão do papel `postgres` no schema `public` | Tabelas: só TRUNCATE, REFERENCES, TRIGGER e MAINTAIN para os papéis da API. Sequências: nada. Funções: nenhuma concessão direta aos papéis da API | `anon`, `authenticated` e `service_role` recebem **tudo** em toda tabela, função e sequência que o `postgres` cria |
| O que vale | Tabelas e sequências: só os `GRANT` explícitos das migrations. Funções: o `EXECUTE` embutido de `PUBLIC` (abaixo) mais os `GRANT` explícitos | Tudo é concedido, salvo `REVOKE` explícito; o acesso depende da RLS e das verificações das funções |
| Tentativa de escrita direta numa tabela | `permission denied` (42501), antes da RLS | A RLS recusa o INSERT; UPDATE e DELETE não tocam linha alguma |
| Função criada sem `REVOKE` | Executável por todos, via `PUBLIC` (inclusive `anon`) | Executável por todos |
| Função com `REVOKE … FROM PUBLIC` apenas | Executável só pelo dono | Ainda executável por `anon`, `authenticated` e `service_role` (concessões diretas do padrão do CLI) |

Os valores do modelo hospedado foram **lidos do Client Preview** (auditoria somente leitura de
2026-11-19, `pg_default_acl`). `scripts/qa/hosted-default-privileges.sql` os reproduz numa stack
descartável.

**Prova de fidelidade (2026-11-19):** numa stack local com esse arquivo e as migrations 0000–0030, os
privilégios efetivos de `anon`, `authenticated`, `service_role`, `authenticator`, `postgres` e
`dashboard_user` no schema `public` são **idênticos** aos lidos do Client Preview real em 0030: 4.434
entradas (tabelas, colunas, funções, sequências e schema), zero diferenças.

## Como a suíte usa os modelos

`scripts/qa/security-suite.sh` lê `QA_PRIVILEGE_MODEL`:

| Valor | Etapa 0d | Uso |
|---|---|---|
| `hosted` (padrão) | Aplica `hosted-default-privileges.sql` **antes** das migrations | Reproduz o Client Preview e a produção. É o modelo contra o qual uma publicação é validada |
| `cli` | Mantém os padrões do Supabase CLI | Reproduz a demo local, o QA local e projetos antigos |

A CI roda os dois: `security (hosted privileges)` e `security (cli privileges)`. O check obrigatório
na proteção da `main` é `security`, um job final que só passa quando os dois passaram.

### O que cada teste prova em cada modelo

| Teste | hosted | cli |
|---|---|---|
| `scripts/security/api_privileges.mjs` (etapas 2c e 9b) | Os privilégios efetivos são **exatamente** `scripts/qa/api-privileges.hosted.json`, mais invariantes (abaixo) | Todo privilégio do manifesto está presente; os extras que o modelo acrescenta são contados e impressos |
| Fixtures SQL, matriz de permissões, scripts de sessão, testes de integração | Mesmas regras de negócio; as recusas de escrita direta acontecem no privilégio | Mesmas regras; as recusas de escrita direta acontecem na RLS |
| `billing_entitlements.sql` | As escritas do owner em `subscriptions` e `billing_plans` são recusadas (42501) | As escritas não tocam nenhuma linha (RLS) |
| `finance-rls-equivalence.db.test.ts` (escrita direta no ledger) | Espera `permission denied` nos três comandos | Espera violação de RLS no INSERT e zero linhas em UPDATE e DELETE |

Nos dois últimos casos o teste **lê o modelo do próprio banco** e exige o comportamento exato daquele
modelo. O estado final (nada mudou) é conferido nos dois.

Um teste que só passa no modelo `cli` prova menos: ali a barreira é só a RLS. No `hosted` há duas
barreiras (privilégio e RLS).

## O manifesto `scripts/qa/api-privileges.hosted.json`

- Lista ordenada de `tipo|objeto|papel|privilégio` para `anon`, `authenticated` e `service_role`,
  depois de todas as migrations, no modelo hospedado.
- Cobre tabelas (inclusive TRUNCATE, REFERENCES, TRIGGER e MAINTAIN), privilégios por coluna
  (SELECT, INSERT, UPDATE e REFERENCES, quando o da tabela não existe), funções, sequências e o
  próprio schema `public`.
- É um **contrato**: privilégio novo ou perdido faz a etapa 2c falhar até o manifesto ser regenerado
  (`node scripts/security/api_privileges.mjs --write`, numa stack descartável no modelo hospedado) e
  revisado como se revisa um `GRANT`.
- Invariantes conferidas mesmo que o manifesto mude (script e `src/test/api-privileges-manifest.test.ts`):
  - `anon` não lê nem grava tabela ou coluna alguma;
  - a única escrita direta de `authenticated`, por tabela ou por coluna, é `UPDATE` em `profiles` (a
    própria linha, por RLS);
  - `anon` executa somente a lista fechada de 18 funções (abaixo);
  - os papéis da API usam o schema `public` e nenhum pode criar objetos nele;
  - as RPCs de venda aposentadas (0036) e as funções de gatilho das migrations de segurança não são
    executáveis por nenhum papel da API;
  - o fluxo de venda atual é executável por `authenticated` e nunca por `anon`;
  - o armazenamento privado das justificativas não tem privilégio de API;
  - `stripe_webhook_events` e `platform_bootstrap` não são legíveis por usuários.

## Regra para migrations novas

- **Tabelas e sequências:** no modelo hospedado nada é concedido por omissão. Toda tabela nova que o
  app lê precisa de `GRANT` explícito.
- **Funções:** o PostgreSQL dá `EXECUTE` a `PUBLIC` em toda função nova, **nos dois modelos**, e o
  padrão do CLI ainda concede diretamente aos três papéis. Por isso toda função nova começa com
  `REVOKE ALL … FROM PUBLIC, anon` (e `authenticated`, se não for para o app) seguido do
  `GRANT EXECUTE … TO authenticated` quando for uma RPC do app. Sem o `REVOKE`, a função fica
  chamável por `anon` também no hospedado.
- O que não deve ser usado precisa de `REVOKE` explícito por papel, para valer também no modelo `cli`.

A migration 0030 existe porque a 0018 criou `permission_profiles` sem `GRANT SELECT`: funcionava nas
stacks locais e falhava no hospedado. A suíte no modelo `hosted` pega esse tipo de erro antes da
publicação.

## Observações do modelo hospedado (registradas, sem ação nesta etapa)

- `anon` e `authenticated` têm TRUNCATE, REFERENCES, TRIGGER e MAINTAIN em 31 tabelas. É o padrão da plataforma
  e não é alcançável pelo PostgREST (não há verbo para isso; as RPCs são `SECURITY DEFINER`). As
  entradas estão no manifesto.
- `anon` executa 18 funções auxiliares pelo `EXECUTE` embutido de `PUBLIC`. Nenhuma grava dados
  (`check-migrations` exige isso), e a lista é fechada: a invariante I8 falha se uma nova aparecer.
  - Sem exposição: predicados que dependem de `auth.uid()` (`is_org_member`, `is_org_owner`,
    `can_manage_org`, `can_manage_member`, `can_operate_location`, `shares_org_with`), dados
    estáticos do catálogo, `get_invitation` (feita para `anon`) e funções de gatilho, que não podem
    ser chamadas diretamente.
  - **Exposição baixa, real:** `has_platform_role(uuid, papel)`, `active_store_count(org)` e
    `org_is_operational` / `assert_org_operational(org)` respondem sobre qualquer UUID sem conferir
    quem chama: se um usuário é admin da plataforma, quantas lojas uma organização tem e se ela
    está operacional. Exigem conhecer o UUID.

As duas são anteriores à M2. Proposta para uma migration futura (decisão do responsável): revogar
TRUNCATE, REFERENCES, TRIGGER e MAINTAIN de `anon` e `authenticated` em todas as tabelas, e revogar de
`PUBLIC` e `anon` as três funções de exposição baixa, concedendo de novo a `authenticated` onde a RLS
precisar.
