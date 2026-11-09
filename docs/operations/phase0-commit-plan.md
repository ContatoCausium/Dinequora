# Fase 0 — Plano de commits por domínio

Status: **executado localmente em 2026-11-09** (ver “Commits criados” no fim). Nenhum push ou merge.
Base: `integration/local-servora-2026` em `aad9599` (igual a `origin/integration/local-servora-2026`;
9 commits à frente de `origin/main`).

Escopo: 141 arquivos com mudança real (77 outros aparecem como modificados só por fim de linha e
somem com o passo 3.1 do plano de reconciliação). Backup verificado em
`C:\dev\Servora-backups\phase0-20261108\` (inclui o incremental de 2026-11-09).

## Regras

1. Um commit por grupo, na ordem abaixo (dependências primeiro). Mensagens no padrão `tipo(escopo): …`.
2. Antes de cada commit: `npx tsc --noEmit`, `npx vitest run` e `node scripts/qa/check-migrations.mjs`
   num worktree temporário com exatamente o conteúdo do commit; o último commit precisa passar a CI
   completa (`quality` + `security`).
3. Arquivos com mudanças de mais de um domínio (marcados ⚑) entram por trechos (`git add -p`), no
   grupo de cada trecho. Se a separação ficar artificial, entram inteiros no primeiro grupo que precisa deles.
4. Nada de `push`/`merge` sem autorização. Revisão sugerida: um PR para `integration/local-servora-2026`.

## Ordem proposta

| #   | Commit                                                                                       | Arquivos                                                                                                                                                                                                                                                                                                                                                              | Observações                                                                                          |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 0   | `chore(repo): normalize line endings`                                                        | `.gitattributes` (novo)                                                                                                                                                                                                                                                                                                                                               | Só após aprovar o §3.1 da reconciliação. Não altera blobs                                            |
| 1   | `feat(db): member permissions, permission indexes and inventory cost protection (0018-0020)` | `drizzle/migrations/0018…`, `0019…`, `0020…`, `meta/_journal.json`                                                                                                                                                                                                                                                                                                    | Já aplicadas na demo; registro 0018–0020 já existe                                                   |
| 2   | `feat(permissions): permission catalog, route guards and generated types`                    | `src/lib/permissions.ts`, `src/lib/route-permissions.ts`, `src/components/app/route-guard.tsx`, `src/integrations/supabase/types.ts`, `src/lib/admin-service.ts`, `src/routes/_authenticated/control.plans.tsx`, `src/test/permissions.test.ts`, `src/test/platform-admin-function.test.ts`                                                                           |                                                                                                      |
| 3   | `feat(shell): workspace permissions, design-system tweaks`                                   | `src/components/app/workspace-context.tsx` ⚑, `src/components/app/app-shell.tsx` ⚑, `src/components/ui/{badge,dialog,sheet}.tsx`, `.claude/skills/servora-premium-design/SKILL.md`                                                                                                                                                                                    | ⚑ escopo de observabilidade → #11; alertas demo → #12                                                |
| 4   | `feat(team): team center with profiles, per-member access and activity`                      | `src/components/team/*` (11), `src/routes/_authenticated/_app/team.tsx`, `src/locales/*/team.json`, `src/test/team-access-model.test.ts`                                                                                                                                                                                                                              |                                                                                                      |
| 5   | `feat(pos): POS, orders and KDS on persisted data`                                           | `src/routes/_authenticated/_app/{pos,orders,kds,menu}.tsx` ⚑, `src/lib/{pos-service,operational.functions,operational-mappers}.ts` ⚑, `src/locales/*/{pos,orders,kds,menu}.json`, `public/media/menu/*` (15), `src/test/pos-service.test.ts`                                                                                                                          | ⚑ pos/kds: captura de erro → #11; KDS inicial e vendas em espera → #12                               |
| 6   | `feat(inventory): inventory, recipes and purchases with cost protection`                     | `src/routes/_authenticated/_app/inventory.tsx`, `src/components/app/operational-create-dialogs.tsx`, `src/locales/*/inventory.json`, `src/test/{inventory-and-auth,recipes-service,consistency-sales-inventory-finance}.test.ts`                                                                                                                                      |                                                                                                      |
| 7   | `feat(finance): finance sections, expenses and models`                                       | `src/components/finance/{expense-form-dialog,finance-model,finance-sections}.tsx/.ts`, `src/lib/{finance-service,expense-metrics}.ts`, `src/routes/_authenticated/_app/finance.tsx`, `src/locales/*/finance.json`, `src/test/{expense-metrics,finance-model}.test.ts`                                                                                                 |                                                                                                      |
| 8   | `feat(dashboards): recorded overview, per-role dashboards and reports`                       | `src/components/app/{recorded-overview,charts,stat-tile}.tsx`, `src/components/finance/{finance-charts,finance-reports}.tsx`, `src/lib/{recorded-data,report-metrics,kitchen-metrics}.ts`, `src/routes/_authenticated/_app/reports.tsx`, `src/locales/*/{dashboard,reports}.json`, `src/test/{report-metrics,kitchen-metrics,phase7-1-acceptance-validation}.test.ts` |                                                                                                      |
| 9   | `feat(intelligence): recorded intelligence and WhatsApp records`                             | `src/routes/_authenticated/_app/intelligence.tsx`, `src/lib/{intelligence-service,whatsapp-service}.ts`, `src/components/intelligence/whatsapp-preview-card.tsx`, `src/locales/*/intelligence.json`, `src/test/{intelligence-service,whatsapp-service}.test.ts`                                                                                                       |                                                                                                      |
| 10  | `feat(i18n): en-US/pt-BR parity and formatting`                                              | `src/lib/{i18n,format,org-service}.ts`, `src/locales/*/{common,settings}.json` ⚑, `src/locales/pt-BR/control.json`, `src/routes/_authenticated/_app/settings.billing.tsx`, `src/test/locale-parity.test.ts`                                                                                                                                                           | ⚑ `shell.notificationsEmpty` → #12                                                                   |
| 11  | `feat(observability): structured logs, scoped error capture, redaction, critical alerts`     | `src/lib/{observability,error-capture}.ts`, `src/server.ts`, `src/start.ts`, `src/routes/__root.tsx`, `src/components/app/states.tsx`, `src/test/observability.test.ts` + trechos ⚑ de #3/#5                                                                                                                                                                          | Fase 0                                                                                               |
| 12  | `fix(data): real organizations never see synthetic figures`                                  | `src/routes/_authenticated/_app/locations.tsx`, `src/lib/location-metrics.ts`, `src/locales/*/locations.json`, `src/test/{phase0-stabilization,store-scope-menu-purchases-pos}.test.ts` + trechos ⚑ (alertas, KDS, vendas em espera, string vazia)                                                                                                                    | Fase 0                                                                                               |
| 13  | `test(security): isolated QA tenant, CI security suite and fixture fixes`                    | `.github/workflows/ci.yml`, `scripts/qa/*` (4), `scripts/security/permission_matrix.mjs`, `scripts/security/reconstructed_{operations,purchases}.sql`                                                                                                                                                                                                                 | Fase 0                                                                                               |
| 14  | `docs/config: phase 0 plans, SMTP readiness, local config, route tree`                       | `docs/operations/*` (novos), `supabase/config.toml`, `src/routes/_authenticated/_app/route.tsx`, `src/routeTree.gen.ts`                                                                                                                                                                                                                                               | `routeTree.gen.ts` é gerado: se o commit #5/#8 precisar das rotas novas para compilar, mover para lá |

## Depois dos commits (com autorização)

- Push da branch e PR para revisão; ativar _branch protection_ em `main` exigindo `ci / quality` e `ci / security`.
- Só então discutir merge em `main`.

## Commits criados (2026-11-09, locais)

Executado com 154 arquivos (69 modificados com diferença real + 85 novos; os arquivos só-fim-de-linha
foram resolvidos pelo `.gitattributes` antes). Cada grupo foi adicionado por lista explícita e o
conteúdo staged foi conferido contra a lista antes de cada commit; nenhum `.env`, credencial, dump,
backup, log ou arquivo temporário entrou. Arquivos com trechos de mais de um domínio entraram inteiros
no primeiro grupo que precisa deles (regra 3): `app-shell.tsx` e `workspace-context.tsx` em _shell_;
`pos.tsx`, `kds.tsx` e `pos-service.ts` em _pos_; `common.json` em _i18n_. O módulo de observabilidade
foi antecipado (commit 3) porque PDV e KDS o importam.

| #   | Hash      | Arquivos | Commit                                                                                     |
| --- | --------- | -------- | ------------------------------------------------------------------------------------------ |
| 1   | `5dd0b2f` | 1        | chore(repo): normalize line endings with .gitattributes                                    |
| 2   | `698401e` | 4        | feat(db): member permissions, permission indexes and inventory cost protection (0018-0020) |
| 3   | `2e76edd` | 11       | feat(observability): structured logs, scoped error capture, redaction and alerts           |
| 4   | `962bdee` | 8        | feat(permissions): permission catalog, route guards and generated types                    |
| 5   | `12efd55` | 6        | feat(shell): workspace permissions, notifications and design-system tweaks                 |
| 6   | `331c8d6` | 15       | feat(team): team center with profiles, per-member access and activity                      |
| 7   | `54694a2` | 31       | feat(pos): POS, orders and KDS on persisted data                                           |
| 8   | `c2964b1` | 7        | feat(inventory): inventory, recipes and purchases with cost protection                     |
| 9   | `cc35f18` | 10       | feat(finance): finance sections, expenses and models                                       |
| 10  | `e5c9087` | 16       | feat(dashboards): recorded overview, per-role dashboards and reports                       |
| 11  | `bccb40d` | 8        | feat(intelligence): recorded intelligence and WhatsApp records                             |
| 12  | `279cc81` | 10       | feat(i18n): en-US/pt-BR parity and formatting                                              |
| 13  | `b44df97` | 6        | fix(data): real organizations never see synthetic figures on Locations                     |
| 14  | `06df149` | 10       | test(security): isolated QA tenant, CI security suite, seed layers and fixture fixes       |
| 15  | (este)    | 11       | docs: phase 0 plans, migration orphans, data layers, local config and route tree           |
