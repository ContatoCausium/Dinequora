# Camadas de dados e estratégia de produção do MARAO

## 1. Quatro camadas, nunca misturadas

| Camada                                                                 | Onde vive                                                                                             | Quem executa                                             | Em produção? |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------ |
| **Estrutura** (tabelas, funções, RLS, catálogo de permissões, planos)  | `drizzle/migrations/` + journal                                                                       | `drizzle-kit migrate`                                    | Sim          |
| **QA** (tenant isolado com seis perfis + segundo tenant)               | `scripts/qa/seed-qa-org.mjs`                                                                          | CI e stack QA local (porta 55321; recusa qualquer outra) | **Nunca**    |
| **Demonstração** (MARAO BURGERS e Harbor Taco Co. empacotados; Aurora) | `scripts/seeds/demo/seed-demo-orgs.sql`; Aurora pelos scripts de seed preservados no backup da Fase 0 | Manualmente, em bancos de demonstração                   | **Nunca**    |
| **Organizações reais**                                                 | Fluxo de cadastro/onboarding do produto (`create_organization`, `create_location`, convites)          | O cliente, pela interface                                | Sim          |

Hoje a camada de estrutura ainda carrega uma sobra de demonstração: `0000` insere MARAO e Harbor e
`0001` as marca `is_demo = true`. Como `0000` está publicada, ela **não é editada**. A correção proposta é
a migration aditiva `docs/proposed-migrations/0021_remove_seed_demo_orgs_on_fresh_databases.sql`:

- só age se o banco **não tem nenhum usuário** (`auth.users` vazio) e as organizações são exatamente as
  sementes (sem criador, sem membros, sem convites); tabelas operacionais têm `NO ACTION`, então qualquer
  pedido/estoque/cardápio impediria a exclusão;
- em qualquer banco com usuários (demo comercial, QA, hospedado em uso) é um no-op.

### Testes em banco descartável (2026-11-09, stack `dq-rebuild`)

| Cenário                                                                                                                    | Resultado                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A. Banco novo: 21 migrations → MARAO (3 unidades, 1 assinatura) e Harbor (1, 1) presentes; integridade das migrations PASS | ok                                                                                                                           |
| A. `0021`                                                                                                                  | “removed: 2”; 0 organizações, 0 unidades, 0 assinaturas (cascade)                                                            |
| A. `seed-demo-orgs.sql`                                                                                                    | MARAO e Harbor recriadas; organizações, unidades e assinaturas **idênticas** às da demo comercial (comparação campo a campo) |
| A. seed repetido                                                                                                           | idempotente (continua 2 organizações, 4 unidades)                                                                            |
| B. Cópia restaurada do dump da demo (7 usuários) + `0021`                                                                  | “kept: database already has users”; contagens idênticas nas 32 tabelas                                                       |
| B. seed de demonstração sobre a cópia                                                                                      | nenhuma alteração                                                                                                            |

### Para ativar (requer aprovação)

1. Mover a proposta para `drizzle/migrations/0021_remove_seed_demo_orgs_on_fresh_databases.sql` e registrar no journal (`drizzle-kit` gera `when`; manter `idx` 21).
2. Na demo comercial ela será no-op (há usuários) — aplicar com `drizzle-kit migrate` registra a linha 21 sem mudar dados; `check-migrations` com `DB_URL` deve passar.
3. Na CI, bancos novos deixam de ter MARAO/Harbor; nenhuma suíte depende deles (verificado: fixtures SQL, seed QA e matriz usam organizações próprias).

## 2. MARAO em produção (quando contrato e onboarding forem confirmados)

Princípio: **a organização de demonstração continua demo**. Produção nasce do zero, pelo fluxo real,
sem copiar nenhuma linha da demonstração.

1. **Projeto separado.** Produção é um projeto Supabase hospedado próprio (não o stack local da demo
   nem o de QA). Credenciais e chaves de produção nunca entram no repositório nem nos stacks locais.
2. **Conta do proprietário.** O responsável do MARAO se cadastra com o e-mail da empresa e confirma o e-mail.
3. **Organização.** `create_organization` pelo onboarding → slug novo `org_<hex>`, `is_demo = false`.
   Não usar o slug `org_marao`: `org-service.ts` mescla conteúdo empacotado de `tenants.ts` a esse slug.
4. **Três unidades.** Primeira criada no onboarding; as outras duas por `create_location`, com nome,
   endereço, fuso e telefone **reais** (hoje só “MARAO Framingham — 61 Hollis St, Framingham, MA 01702”
   está verificada; “Location 2/3” são placeholders da demo e não devem ser copiadas). Horários pelo
   editor de horários (validação no banco).
5. **Plano.** Três unidades exigem plano com limite ≥ 3 (Growth) ou ajuste auditado por admin da
   plataforma (`admin_set_subscription`/`store_limit_override`). Cobrança Stripe é fase posterior.
6. **Equipe.** Convites com perfil por função e acesso por unidade (gerente por loja, caixa, cozinha,
   estoque, financeiro); cada funcionário mantém o próprio idioma (en-US/pt-BR).
7. **Cardápio, estoque, fichas técnicas e fornecedores** cadastrados pelo cliente (ou importação
   futura a partir de arquivos que ele fornecer) — nunca a partir da demo.
8. **Isolamento.** RLS por organização e por unidade já cobre o banco; a matriz de permissões e as
   fixtures SQL rodam na CI a cada mudança. A demo e o QA ficam em bancos distintos da produção.
9. **Checklist de entrada em produção:** `check-migrations` (somente leitura) no projeto de produção,
   backup, aplicação das migrations pendentes, criação do admin da plataforma pelo bootstrap documentado
   (`docs/operations/platform-admin-bootstrap.md`), onboarding acima, validação de login de cada perfil.
