# Camadas de dados e estratégia de produção do MARAO

## 1. Quatro camadas, nunca misturadas

| Camada                                                                 | Onde vive                                                                                             | Quem executa                                             | Em produção? |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------ |
| **Estrutura** (tabelas, funções, RLS, catálogo de permissões, planos)  | `drizzle/migrations/` + journal                                                                       | `drizzle-kit migrate`                                    | Sim          |
| **QA** (tenant isolado com seis perfis + segundo tenant)               | `scripts/qa/seed-qa-org.mjs`                                                                          | CI e stack QA local (porta 55321; recusa qualquer outra) | **Nunca**    |
| **Demonstração** (MARAO BURGERS e Harbor Taco Co. empacotados; Aurora) | `scripts/seeds/demo/seed-demo-orgs.sql`; Aurora pelos scripts de seed preservados no backup da Fase 0 | Manualmente, em bancos de demonstração                   | **Nunca**    |
| **Organizações reais**                                                 | Fluxo de cadastro/onboarding do produto (`create_organization`, `create_location`, convites)          | O cliente, pela interface                                | Sim          |

Hoje a camada de estrutura ainda carrega uma sobra de demonstração: `0000` insere MARAO e Harbor e
`0001` as marca `is_demo = true`. Como `0000` está publicada, ela **não é editada**. A correção é a
migration aditiva **`drizzle/migrations/0021_remove_seed_demo_orgs_on_fresh_databases.sql`** (no journal
desde a Fase 1.0; a proposta original em `docs/proposed-migrations/` virou um ponteiro para ela):

Política: **qualquer coisa que não seja exatamente a semente original é dado legítimo e a organização
fica.** A 0021 só remove uma organização semeada quando todas as condições abaixo são verdadeiras:

- o banco **não tem nenhum usuário** (`auth.users` vazio); com qualquer usuário é um no-op;
- a organização é idêntica à semente original em **todas** as colunas, exceto `id` e `created_at`;
- as lojas são exatamente as lojas originais (nenhuma a mais ou a menos, nenhuma coluna alterada, nenhuma
  atualizada depois de criada);
- a assinatura é exatamente a original, incluindo períodos de cobrança e sem IDs do Stripe;
- **nenhuma linha em nenhuma tabela** dos esquemas `public` e `storage` menciona a organização ou suas
  lojas (id ou slug) em colunas uuid, texto ou JSON. A varredura usa o catálogo do banco: cobre relações
  CASCADE, SET NULL e NO ACTION, tabelas sem FK e tabelas futuras (membros, convites, perfis, acessos por
  loja, eventos de cobrança, webhooks do Stripe, auditoria e todo dado operacional).

Qualquer condição falsa, ou qualquer erro durante a verificação, **mantém** a organização e registra um
`NOTICE` com o motivo. Por causa da varredura, a exclusão só pode levar as lojas e a assinatura originais
e nenhum registro de auditoria é desvinculado; uma pós-condição confere isso e desfaz a exclusão se falhar.

A suíte de segurança verifica, num banco novo, que nenhuma organização existe depois de todas as
migrations e que o seed de demonstração recria MARAO e Harbor (duas vezes, sem duplicar) exatamente como
na demo, sem nenhuma outra linha referenciando-as.

### Testes em banco descartável da versão anterior da proposta (2026-11-09, stack `dq-rebuild`)

| Cenário                                                                                                                    | Resultado                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A. Banco novo: 21 migrations → MARAO (3 unidades, 1 assinatura) e Harbor (1, 1) presentes; integridade das migrations PASS | ok                                                                                                                           |
| A. `0021`                                                                                                                  | “removed: 2”; 0 organizações, 0 unidades, 0 assinaturas (cascade)                                                            |
| A. `seed-demo-orgs.sql`                                                                                                    | MARAO e Harbor recriadas; organizações, unidades e assinaturas **idênticas** às da demo comercial (comparação campo a campo) |
| A. seed repetido                                                                                                           | idempotente (continua 2 organizações, 4 unidades)                                                                            |
| B. Cópia restaurada do dump da demo (7 usuários) + `0021`                                                                  | “kept: database already has users”; contagens idênticas nas 32 tabelas                                                       |
| B. seed de demonstração sobre a cópia                                                                                      | nenhuma alteração                                                                                                            |

### Aplicação (cada ambiente exige autorização própria)

1. Feito: migration registrada no journal (`idx` 21) e no manifesto de hashes.
2. Na demo comercial ela será no-op (há usuários) — aplicar com `drizzle-kit migrate` registra a linha 21
   sem mudar dados; `check-migrations` com `DB_URL` deve passar. **Não aplicada.**
3. Na CI, bancos novos deixam de ter MARAO/Harbor; nenhuma suíte depende deles (verificado: fixtures SQL,
   seed QA e matriz usam organizações próprias).
4. Ao recriar uma demonstração do zero: aplicar as migrations e depois `scripts/seeds/demo/seed-demo-orgs.sql`.

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
