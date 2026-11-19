# Checklist de publicação da M2 (0031, 0032, 0033)

Para quando a publicação for autorizada. **Cada item que toca um ambiente hospedado precisa de
autorização específica do responsável.** Nada aqui foi executado fora de stacks descartáveis.

## Antes

- [ ] Branch e commit aprovados. Hashes das migrations iguais aos de `scripts/qa/migration-hashes.json`
      (`node scripts/qa/check-migrations.mjs`: PASS).
- [ ] Suíte de segurança completa num stack descartável novo (`scripts/qa/security-suite.sh`),
      inclusive os passos 5g (isolamento), 5h (integridade de concessões) e 8 (rollback e
      reaplicação).
- [ ] Testes de integração com banco, `gen-types --check`, tsc, lint, testes unitários e build: verdes.
- [ ] Decisões pendentes registradas: retenção da justificativa
      ([m2-rollback/README.md](m2-rollback/README.md)) e leitura do motivo por quem tem `pos.sell` (H2).
- [ ] Ambiente de destino conferido: projeto, ref e que o banco está em **0030**, com tracker de 31
      linhas.
- [ ] Backup completo do banco de destino, com SHA-256 conferido e restauração testada num stack
      isolado.
- [ ] Janela de pouco movimento: ninguém fechando caixa nem exportando relatórios grandes.

## Aplicação

1. [ ] **App** primeiro, ou junto. O app novo funciona com e sem as funções novas. O Worker anterior
       (55493d4) também funciona com o banco em 0033 (ensaiado).
2. [ ] **Migrations** pelo mecanismo único (`scripts/preview/hosted-db.mjs` → `drizzle-kit migrate`).
       **Não** exporte `PGOPTIONS`: o limite de lock está dentro da 0031 e da 0033
       (`set local lock_timeout = '5s'`), e as três migrations entram numa única transação.
3. [ ] Se sair `drizzle-kit migrate failed (exit 1)`:
       - o drizzle-kit não imprime a causa;
       - confira no log do Postgres se houve `canceling statement due to lock timeout`;
       - confirme que o tracker continua com 31 linhas (nada foi aplicado);
       - repita depois. Nunca contorne o limite.
4. [ ] Tracker com 34 linhas; `check-migrations` com `DB_URL` do destino: PASS (somente leitura).

## Verificação (somente leitura onde possível)

- [ ] Finance, Reports e Insights batem com o leitor paginado (smoke). O Worker chama
      `rpc/ledger_day_totals`.
- [ ] `orders.resolve_pending`: owners e o perfil `org_admin` têm; managers sem concessão, staff e
      admin da plataforma não.
- [ ] Nenhum membro com extras fora do teto, nenhum staff com perfil de manager e nenhum owner com
      perfil. Os registros `member.extras_pruned` da migration (ator nulo) foram conferidos: cada um
      é uma concessão inerte removida ou um perfil convertido em concessões equivalentes. A migration
      garante que nenhuma permissão efetiva mudou.
- [ ] Tela de Equipe: editar um staff e um manager funciona. A tela usa `set_member_access`, que já
      exigia um perfil do nível escolhido. `set_member_role`, que a tela não usa, agora também recusa
      rebaixar para staff quem tem perfil de manager.
- [ ] Monitoramento: erros do Worker (incluindo `isolation_unsupported`, que não deve aparecer) e
      tempo das leituras do ledger.

## Critério de rollback

Ledger ilegível, divergência de totais ou falha de venda atribuível à M2 ⇒ rollback pelo
procedimento de [m2-rollback/README.md](m2-rollback/README.md), como migration nova revisada.
Banco primeiro; o app atual se adapta sozinho.
