# Checklist de publicação da M2 (0031–0036)

Para quando a publicação for autorizada. **Cada item que toca um ambiente hospedado precisa de
autorização específica do responsável.** Nada aqui foi executado fora de stacks descartáveis.

As migrations da publicação são seis:
- **0031:** agregação do ledger.
- **0032:** resolução de venda pendente.
- **0033:** integridade de concessões, isolamento e justificativa.
- **0034:** definição de Owner pela plataforma ([platform-owner-assignment.md](platform-owner-assignment.md)).
- **0035:** privacidade das justificativas ([pending-reason-privacy.md](pending-reason-privacy.md)).
- **0036:** RPCs de venda antigas fora da API ([pos-sale-flow-security.md](pos-sale-flow-security.md)).

## Antes

- [ ] Branch e commit aprovados. Hashes das migrations iguais aos de `scripts/qa/migration-hashes.json`
      (`node scripts/qa/check-migrations.mjs`: PASS).
- [ ] Suíte de segurança completa num stack descartável novo (`scripts/qa/security-suite.sh`), **no
      modelo de privilégios `hosted`** (o padrão; reproduz o Client Preview) e também no `cli`
      ([privilege-models.md](privilege-models.md)), inclusive:
      - 0d e 2c: modelo de privilégios e privilégios da API iguais ao manifesto;
      - 5g: isolamento;
      - 5h: integridade de concessões;
      - 5i: definição de Owner;
      - 5j: privacidade das justificativas;
      - 5k: fluxo de venda do PDV;
      - 7: integração pelo PostgREST;
      - 8 e 9: rollback e reaplicação.
- [ ] Testes de integração com banco, `gen-types --check`, tsc, lint, testes unitários e build: verdes.
- [ ] Decisões pendentes registradas:
      - retenção da justificativa ([pending-reason-retention.md](pending-reason-retention.md));
      - Admin da organização concedendo `orders.resolve_pending`
        ([org-admin-grant-proposal.md](org-admin-grant-proposal.md)).
- [ ] Ambiente de destino conferido, somente leitura e com autorização:
      - projeto, ref, e banco em **0030** com tracker de 31 linhas;
      - `DB_URL=<destino> node scripts/qa/check-migrations.mjs --preflight`: PASS, listando
        0031–0036 como pendentes e nenhuma entrada "would be skipped by the migrator";
      - o build de servidor publicado no destino contém o commit `10b2d94` (o app chama as RPCs v2):
        condição da 0036. O Worker `55493d4` contém;
      - as consultas de collation, isolamento padrão, convites pendentes e dados que a 0033 converte
        (procedimento somente leitura do relatório de fechamento de segurança).
- [ ] Backup completo do banco de destino, com SHA-256 conferido e restauração testada num stack
      isolado.
- [ ] Janela de pouco movimento: ninguém fechando caixa nem exportando relatórios grandes.
      - A 0035 altera a policy de `audit_logs` e a tabela `pos_sale_key_voids`, o que exige um lock
        exclusivo breve.
      - Enquanto espera esse lock (até 5 s), as gravações de auditoria das RPCs ficam na fila.

## Aplicação

1. [ ] **App** primeiro, ou junto. O app novo funciona com e sem as funções novas. O Worker anterior
       (55493d4) também funciona com o banco em 0035: lê só `created_at` das chaves encerradas.
2. [ ] **Migrations** pelo mecanismo único (`scripts/preview/hosted-db.mjs` → `drizzle-kit migrate`).
       - **Não** exporte `PGOPTIONS`: o limite de lock está dentro da 0031, da 0033, da 0034 e da
         0035 (`set local lock_timeout = '5s'`).
       - As seis migrations entram numa única transação.
3. [ ] Se sair `drizzle-kit migrate failed (exit 1)`:
       - o drizzle-kit não imprime a causa;
       - confira no log do Postgres se houve `canceling statement due to lock timeout`;
       - confirme que o tracker continua com 31 linhas (nada foi aplicado);
       - repita depois. Nunca contorne o limite.
4. [ ] Tracker com 37 linhas; `check-migrations` com `DB_URL` do destino: PASS (somente leitura).

## Verificação (somente leitura onde possível)

- [ ] Finance, Reports e Insights batem com o leitor paginado (smoke). O Worker chama
      `rpc/ledger_day_totals`.
- [ ] `orders.resolve_pending`: owners e o perfil `org_admin` têm; managers sem concessão, staff e
      admin da plataforma não.
- [ ] Nenhum membro com extras fora do teto, nenhum staff com perfil de manager e nenhum owner com
      perfil. Os registros `member.extras_pruned` da migration (ator nulo) foram conferidos: cada um
      é uma concessão inerte removida ou um perfil convertido em concessões equivalentes. A migration
      garante que nenhuma permissão efetiva mudou.
- [ ] Justificativas:
      - nenhuma chave encerrada com `reason` diferente do marcador `[moved to pos_pending_resolution_reasons]`;
      - nenhum evento `pos.pending_sale_*` com `metadata.reason`;
      - registros `pos.pending_reasons_moved` conferidos (esperado: nenhum no hospedado, que nunca
        rodou a 0032);
      - havendo sobra (só possível num banco que já estava em 0033), reaplicar a 0035 (idempotente).
- [ ] Separação operador/Owner: listar, somente leitura, contas com papel de plataforma que são Owner de
      organização de cliente (`user_roles` × `organization_members` × `organizations.is_demo = false`).
      A 0034 não altera linhas existentes; cada caso é decisão do responsável.
- [ ] `admin_assign_owner` em organização com Owner recusa (`owner_exists`). Isso só pode ser
      verificado onde existir um admin da plataforma; o Client Preview não tem.
- [ ] Tela de Equipe: editar um staff e um manager funciona. A tela usa `set_member_access`, que já
      exigia um perfil do nível escolhido. `set_member_role`, que a tela não usa, agora também recusa
      rebaixar para staff quem tem perfil de manager.
- [ ] Tela de atividade: um manager vê os eventos das suas lojas e os da organização, e não os de
      outras lojas.
- [ ] Monitoramento: erros do Worker (incluindo `isolation_unsupported`, que não deve aparecer) e
      tempo das leituras do ledger.

## Critério de rollback

Ledger ilegível, divergência de totais ou falha de venda atribuível à M2 ⇒ rollback pelo
procedimento de [m2-rollback/README.md](m2-rollback/README.md), como migration nova revisada.
Para 0034 e 0035 isoladamente, use [security-closure/README.md](security-closure/README.md).
Banco primeiro; o app atual se adapta sozinho.
