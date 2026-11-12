# Guard de destino e operações de banco (PR #23)

Todo script que grava num banco (testes, seeds, fixtures, migrations, restaurações) só roda quando o
**próprio banco** prova que pode receber aquela operação. Porta, nome do projeto, hostname e variáveis
de ambiente não autorizam nada. Não existe chave para desligar o guard.

## Por que

Até o PR #22, a configuração da CI (`scripts/qa/supabase/config.toml`) usava o mesmo `project_id`
(`dq-rebuild`) e as mesmas portas (55321/55322) do **QA persistente**. Cada script verificava só a
porta, então:

- `seed-qa-org.mjs`, `permission_matrix.mjs`, os scripts de corrida e os testes de integração gravariam
  no QA persistente se fossem executados diretamente;
- `permission_matrix.mjs` gravava na demo com `ALLOW_DEMO_WRITES=1`;
- as fixtures SQL aceitavam um opt-in (`dinequora.fixture_target`) que qualquer sessão podia definir;
- os scripts Python gravavam no `VITE_SUPABASE_URL` do `.env`, que podia ser um projeto hospedado;
- o seed da demo e o `drizzle-kit migrate` não verificavam o destino.

## Como um banco é identificado

| Elemento        | De onde vem                                                                                                                               | Para que serve                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Cluster         | `system_identifier` do PostgreSQL (`pg_control_system()`), exibido só como os 12 primeiros dígitos de `sha256('dinequora-cluster:' + id)` | Muda em todo cluster novo, inclusive no de um backup restaurado                                 |
| Banco           | OID do banco (`pg_database.oid`)                                                                                                          | Muda ao recriar o banco, por exemplo numa restauração com drop/create, ou numa cópia `TEMPLATE` |
| Marcador        | `dq_guard.marker`: uma linha com cluster, OID e finalidade (`new-empty` ou `adopted-copy`)                                                | Identificação positiva de banco descartável                                                     |
| Lista protegida | `scripts/guard/protected-clusters.json`: hashes do QA e da demo, nunca o identificador bruto                                              | Nunca podem receber `claim` nem `adopt`, mesmo com marcador forjado                             |
| Local           | Só loopback (`127.0.0.1`, `localhost`, `::1`)                                                                                             | Destinos remotos (hospedados, produção) são recusados **antes de conectar**                     |

**Classes:**

| Classe         | Significado                                           |
| -------------- | ----------------------------------------------------- |
| `qa` / `demo`  | Clusters protegidos                                   |
| `disposable`   | Marcador válido para este cluster e este banco        |
| `unregistered` | Qualquer outro banco local, como uma cópia restaurada |
| remoto         | Recusado                                              |

Uma cópia restaurada nunca é descartável automaticamente. O marcador copiado traz o cluster e o OID de
origem e deixa de valer. A cópia do QA nem tem marcador.

## Como um banco vira descartável

- **`claim`:** `node scripts/guard/target-guard.mjs claim --db-url URL` cria o marcador.
  - Só funciona num banco **novo e vazio**: sem rastreador de migrations, sem tabela em `public`, sem
    usuário.
  - O cluster não pode estar na lista protegida.
  - É idempotente enquanto o banco continuar vazio, e roda com lock consultivo (claims concorrentes
    resultam num único marcador).
  - É a etapa 0b da suíte.
- **`adopt`:** `... adopt --db-url URL --confirm adopt:<cluster>` aceita uma cópia, por exemplo um
  backup do QA restaurado numa stack descartável para ensaio.
  - Exige o código do próprio cluster.
  - Nunca vale para clusters protegidos.
  - A cópia adotada vale para testes, nunca como "banco novo": a suíte e as migrations do zero continuam
    exigindo `claim`.
- **Fim automático do `claim`:** um banco marcado como novo e vazio deixa de ser descartável assim que
  tiver um usuário fora dos domínios reservados para testes (`.test`, `.example`, `.invalid`,
  `.localhost`) ou sem e-mail. Por exemplo, uma stack de teste mantida como staging ou QA e usada por
  pessoas. A verificação vale na CLI e no `dq_guard.attest` em SQL.

### Banco persistente novo

Um cluster novo que vai guardar dados importantes (outro QA, staging, um ambiente de piloto) deve entrar
em `scripts/guard/protected-clusters.json` **antes** de receber esses dados:

```
docker exec <contêiner> psql -U postgres -At -c "select system_identifier from pg_control_system()"
printf 'dinequora-cluster:%s' <id> | sha256sum      # só o hash vai para o arquivo
```

Enquanto não estiver na lista, ele ainda tem três barreiras:

- sem `claim` (que exige banco vazio), ele é `unregistered` e todo script de teste o recusa;
- se tiver sido marcado vazio e depois recebido usuários reais, o marcador perde a validade;
- migrations e restaurações exigem a confirmação desse cluster.

## Por onde cada script é verificado

O guard verifica pelo **mesmo canal** que o script usa para gravar:

| Canal                             | Scripts                                                                                                    | Verificação                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| SQL (psql)                        | todas as fixtures de `scripts/security/*.sql` que gravam, e `fixture_legacy_ids.sql`                       | bloco no topo chama `dq_guard.attest('fixture:…')`; sem a função ou com marcador inválido, recusa antes de qualquer escrita |
| Conexão direta (postgres.js)      | `tax_rate_concurrency`, `menu_category_race`, `menu_category_deactivate_race`, `menu_category_intent_race` | `assertDisposableDb(DB_URL, op)` antes de conectar para gravar                                                              |
| API (PostgREST, chave de serviço) | `seed-qa-org.mjs`, `permission_matrix.mjs`                                                                 | `assertDisposableApi(SB_URL, chave, op)`: o banco **por trás da API** atesta por `dq_guard.attest`                          |
| SQL + API                         | testes de integração (`src/test/integration/*.db.test.ts`)                                                 | `disposableQa()` atesta os dois canais                                                                                      |
| Seed da demo                      | `scripts/seeds/demo/seed-demo-orgs.sql`                                                                    | banco descartável, ou `PGOPTIONS="-c dq_guard.confirm=seed-demo:<cluster>"` desse cluster                                   |

Detalhes do canal pela API:

- A stack de CI/testes expõe só o schema `dq_guard`, criado vazio pelo seed da própria stack
  (`scripts/qa/supabase/guard-schema.sql`).
- O `claim` concede `attest` apenas ao `service_role`. A chave `anon` e qualquer API de outra stack são
  recusadas.

**`drizzle-kit` direto.** A `drizzle.config.ts` chama `target-guard.mjs migrate-gate` antes de qualquer
comando que conecte (`migrate`, `push`, …). A trava lê a URL e a confirmação do ambiente, nunca da
linha de comando.

| Destino                                | Regra                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Sem URL                                | Nada a proteger                                                                                                  |
| Banco descartável                      | Passa                                                                                                            |
| QA, demo ou banco local não registrado | Só com `DQ_GUARD_CONFIRM=migrate:<classe>:<cluster>`, que o `db-ops migrate` define depois das verificações dele |
| Host remoto (produção)                 | Só com `DQ_GUARD_CONFIRM=migrate:remote:<host>`, do roteiro de produção                                          |

A trava não imprime o código esperado.

Os scripts Python legados (`create_test_accounts`, `regression_locations_team`, `tenant_isolation_check`,
`onboarding_branding_check`) foram **aposentados**: param na primeira linha. Os cenários de billing e de
equipe do `regression_locations_team` foram portados para `scripts/security/billing_entitlements.sql`
(etapa 3 da suíte, em transação revertida).

## A suíte

Etapas do `scripts/qa/security-suite.sh`:

| Etapa       | O que faz                                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0a          | No banco novo ainda sem marcador, roda cada script diretamente e exige recusa sem nenhuma mudança: seed, matriz (com `ALLOW_DEMO_WRITES=1`), chave `anon`, corrida, teste de integração, fixture com o antigo opt-in e seed da demo |
| 0b          | `claim`                                                                                                                                                                                                                             |
| 0c          | Autoverificação do guard (`scripts/guard/selftest.sh`) em bancos de prova do mesmo cluster                                                                                                                                          |
| 1 em diante | Como antes; cada script reverifica o marcador                                                                                                                                                                                       |

A autoverificação 0c cobre:

- destinos remotos, porta fechada e URL inválida;
- variáveis genéricas (`DQ_GUARD_DISABLE`, `ALLOW_DEMO_WRITES`, o antigo opt-in);
- cópia `TEMPLATE` com marcador copiado e marcador adulterado;
- banco populado e `adopt` com código errado ou de outra operação;
- claims concorrentes;
- a confirmação do seed da demo.

A CI usa uma stack própria (`project_id = "dq-ci"`, portas 64421/64422/64420), que não coincide com o QA
persistente nem com a demo.

## Operações em bancos persistentes: `scripts/ops/db-ops.mjs`

Ter a ferramenta não autoriza usá-la: cada uso no QA, na demo ou em qualquer banco não descartável
precisa de autorização explícita do responsável.

| Comando                   | Faz                                                                                                                                                                                                                                  | Escreve?                      | Confirmação                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------- |
| `inspect`                 | Destino, classe, cluster, migrations aplicadas e pendentes, sessões diretas, requisições recentes na API (log do gateway, só contadas)                                                                                               | não (sessões somente leitura) | —                                                         |
| `precheck --backup DIR`   | Rastreador como prefixo do journal; sem cliente direto; API em silêncio (`--api-window`, padrão 5 min); backup íntegro (SHA-256), do **mesmo cluster**, legível; estado atual = impressão digital do backup; histórico = o do backup | não                           | —                                                         |
| `backup --out NOVA_PASTA` | `pg_dump -Fc` + globais sem senhas + impressão digital antes e depois + histórico + MANIFEST (cluster em hash) + SHA256SUMS; nunca sobrescreve                                                                                       | não (no banco)                | —                                                         |
| `migrate --backup DIR`    | `precheck` (com migrations pendentes) e, depois, `drizzle-kit migrate` (uma transação)                                                                                                                                               | sim                           | `migrate:<classe>:<cluster>`, exceto em banco descartável |
| `recover --backup DIR`    | Restaura o banco `postgres` a partir do backup: configurações, ACL e comentário reaplicados; impressão digital conferida                                                                                                             | sim, destrutivo               | sempre `recover:<classe>:<cluster>`                       |

**Regras:**

- **Mesmo banco nos dois canais:** `--db-url` e `--container` precisam apontar para o mesmo banco
  (cluster e OID).
- **Lock:** `migrate` e `recover` usam um lock consultivo do cluster; duas operações nunca se sobrepõem.
- **Prazos:** toda conexão tem prazo de 20 s e toda chamada ao Docker tem prazo (2 min; dump e
  restauração, 30 min). Conexão resetada ou sem resposta resulta em parada, nunca em espera
  indefinida.
- **Clusters protegidos:** só aceitam backups **deles mesmos**.
- **Falhas:**
  - Uma falha mostra o próximo passo manual. **Nenhuma restauração acontece automaticamente.**
  - Se o `drizzle-kit` falhar, a transação é desfeita e basta confirmar com `inspect`.
- **Saída:** nunca mostra senhas, chaves, URLs com credenciais nem o identificador bruto do cluster.
- **Restauração em bancos não protegidos:** o `recover` recria o schema `dq_guard` **vazio**, para o
  PostgREST da stack de testes subir. A cópia continua `unregistered`.
- **Script histórico:** o `recover-postgres-db.sh` do ensaio (fora do repositório) continua como estava;
  o `recover` reproduz os mesmos passos.

## Procedimento do QA após este PR (cada passo exige a autorização correspondente)

```
QA_DB=<DB_URL de `supabase status --workdir C:\dev\dq-rebuild\supabase`>
node scripts/ops/db-ops.mjs inspect  --db-url "$QA_DB" --container supabase_db_dq-rebuild
#   esperado: class qa, cluster 754f347beef5, 21 applied, 9 pending (0021–0029), 0 direct clients, 0 API requests
node scripts/ops/db-ops.mjs precheck --db-url "$QA_DB" --container supabase_db_dq-rebuild \
     --backup C:\dev\Servora-backups\qa-dq-rebuild-20261112T033955Z
#   todas as linhas PASS; qualquer FAIL encerra o procedimento
node scripts/ops/db-ops.mjs migrate  --db-url "$QA_DB" --container supabase_db_dq-rebuild \
     --backup C:\dev\Servora-backups\qa-dq-rebuild-20261112T033955Z --confirm migrate:qa:754f347beef5
# validação: check-migrations (modo banco), snapshot de preservação, mudanças esperadas, smoke e fluxos em
# transação revertida (PLAN-0021-0029.md, de 2026-11-12)
# se a validação falhar, é uma decisão separada:
node scripts/ops/db-ops.mjs recover  --db-url "$QA_DB" --container supabase_db_dq-rebuild \
     --backup C:\dev\Servora-backups\qa-dq-rebuild-20261112T033955Z --confirm recover:qa:754f347beef5
```

As suítes que gravam dados (matriz, corridas, integração) **nunca** rodam no QA. Para rodá-las sobre os
dados do QA depois da migração:

1. tirar um `backup` do QA;
2. fazer `recover` dele numa stack descartável;
3. fazer `adopt` explícito dessa cópia;
4. rodar as suítes ali.
