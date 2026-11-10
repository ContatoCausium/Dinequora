# Ambiente de produção — `dinequora-production`

Status: **preparação**. Nenhuma conexão foi feita com o projeto, nenhuma migration foi aplicada e
nenhuma configuração foi alterada. Documento criado em 2026-11-10.

Este é o roteiro de preparação do banco de produção do Dinequora (antes chamado Servora). Cada etapa
que toca o projeto hospedado exige autorização explícita do responsável (seção 13).

## 1. Identificação

| Item               | Valor                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| Nome exibido       | `dinequora-production`                                                |
| Provedor e plano   | Supabase Pro                                                          |
| Região             | East US (North Virginia)                                              |
| Compute            | Micro                                                                 |
| Estado do banco    | Novo e vazio: sem tabelas, sem migrations, sem usuários               |
| Project Reference  | `<project-ref>` — **não registrado neste repositório**                |
| URL da API         | `https://<project-ref>.supabase.co`                                   |
| Credenciais        | Sob guarda do responsável; nunca no repositório nem nos stacks locais |
| Repositório GitHub | `ContatoCausium/Dinequora`, branch `main` protegida                   |
| Hospedagem do app  | **Pendente de decisão** (seção 2)                                     |

**Nome exibido ≠ Project Reference ≠ URL.** O nome `dinequora-production` existe só no painel do
Supabase e na documentação; o código nunca o usa. O Project Reference é um identificador aleatório
gerado pelo Supabase: copie-o do painel (Project Settings → General) direto para o cofre de senhas e
para a hospedagem. Nunca o deduza do nome nem o grave em arquivo versionado.

## 2. Arquitetura

| Camada     | Como funciona                                                                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicação  | React 19 + TanStack Start com SSR (Nitro), configurada por `@lovable.dev/vite-tanstack-config`. Esse pacote usa Cloudflare como alvo **padrão de build**, o que **não é** uma decisão de hospedagem.                                                       |
| Hospedagem | **Pendente de decisão.** A escolha define o preset de build do Nitro, onde ficam as variáveis de build e de execução (seção 4) e o domínio do aplicativo (Site URL do Auth). Nenhum provedor deve ser tratado como definitivo antes da decisão registrada. |
| Banco      | Postgres do Supabase. O navegador usa só a chave publicável; o isolamento entre organizações e unidades está no banco (RLS em todas as tabelas de `public` e funções `SECURITY DEFINER` com `search_path` fixo e catálogo de permissões).                  |
| Migrations | SQL escrito à mão em `drizzle/migrations/`, aplicado por `drizzle-kit migrate` na ordem de `meta/_journal.json` e rastreado em `drizzle.__drizzle_migrations` (`migration-policy.md`). Não existe `supabase/migrations`. Estado atual na seção 5.          |
| Auth       | Supabase Auth com e-mail e senha e confirmação obrigatória. O gatilho `on_auth_user_created` (`handle_new_user`) cria o perfil. O login com Google depende hoje do Lovable Cloud Auth (seção 6).                                                           |
| Realtime   | Publicação `supabase_realtime` com `orders` e `order_items`, configurada pelas migrations 0013 e 0017. A Cozinha (KDS) escuta `postgres_changes`; o RLS também vale para o Realtime.                                                                       |
| Storage    | Não usado: nenhum bucket. O logotipo é rasterizado no navegador e gravado em `organizations`.                                                                                                                                                              |
| E-mail     | Resend, em dois canais separados: SMTP para os e-mails do Supabase Auth e API para os e-mails da aplicação (seção 8).                                                                                                                                      |
| Agendador  | Não usado: sem `pg_cron` nem `pg_net`. `cron-auth.ts` existe, mas não é chamado.                                                                                                                                                                           |
| Cobrança   | Tabelas de planos e assinaturas existem; não há integração ativa com Stripe nem tratamento de webhook.                                                                                                                                                     |

## 3. Ambientes, sempre separados

| Ambiente     | Onde                                                     | Dados                                     |
| ------------ | -------------------------------------------------------- | ----------------------------------------- |
| Demonstração | Stack local (`supabase/config.toml`), portas 54321/54322 | Fictícios (organizações demo)             |
| QA           | Stack local `dq-rebuild`, portas 55321/55322             | Fixtures de teste                         |
| CI           | Banco descartável criado a cada execução do job          | Criados e destruídos pela suíte           |
| **Produção** | Projeto hospedado `dinequora-production`                 | **Somente dados reais, criados pelo uso** |

Nenhuma linha é copiada da demonstração ou do QA para a produção (`data-layers-and-marao-production.md`).
Os arquivos `.env` e `.env.local` das worktrees continuam apontando para o stack local e não devem
ser editados para produção.

## 4. Variáveis e segredos (somente nomes)

O destino exato de cada variável depende da hospedagem escolhida (seção 2).

| Variável                                              | Quem lê                                                   | Onde fica em produção                           | Natureza                       |
| ----------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- | ------------------------------ |
| `VITE_SUPABASE_URL`                                   | Navegador (embutida no build)                             | Variáveis de build da hospedagem                | Pública                        |
| `VITE_SUPABASE_PUBLISHABLE_KEY`                       | Navegador (embutida no build)                             | Variáveis de build da hospedagem                | Pública (protegida pelo RLS)   |
| `SUPABASE_URL`                                        | Servidor (SSR)                                            | Variáveis de execução da hospedagem             | Pública                        |
| `SUPABASE_PUBLISHABLE_KEY`                            | Servidor (SSR)                                            | Variáveis de execução da hospedagem             | Pública                        |
| `VITE_SUPPORT_EMAIL`                                  | Navegador (`platform-contact.ts`; ainda sem uso em telas) | Variáveis de build da hospedagem                | Pública                        |
| `OBSERVABILITY_ENVIRONMENT`                           | Servidor                                                  | Variáveis de execução (ex.: `production`)       | Pública                        |
| `OBSERVABILITY_ALERT_WEBHOOK_URL`                     | Servidor                                                  | Secret de servidor da hospedagem                | **Secreta**                    |
| `RESEND_API_KEY`                                      | Servidor: envio da aplicação (quando implementado)        | Secret de servidor da hospedagem                | **Credencial secreta**         |
| `RESEND_FROM_EMAIL`                                   | Servidor: envio da aplicação (quando implementado)        | Variáveis de servidor da hospedagem             | Configuração de servidor       |
| `RESEND_REPLY_TO`                                     | Servidor: envio da aplicação (quando implementado)        | Variáveis de servidor da hospedagem             | Configuração de servidor       |
| `LOVABLE_DB_MIGRATION_URL`                            | `drizzle-kit migrate` (operador)                          | Só na sessão de terminal, durante a aplicação   | **Secreta** (conexão do banco) |
| `DB_URL`                                              | `check-migrations.mjs` em modo banco                      | Só na sessão de terminal, durante a conferência | **Secreta** (conexão do banco) |
| `SUPABASE_SERVICE_ROLE_KEY`                           | `client.server.ts` (hoje sem uso)                         | **Não configurar** enquanto não houver uso      | **Secreta**; ignora o RLS      |
| `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS` | `cron-auth.ts` (hoje sem uso)                             | **Não configurar** enquanto não houver uso      | **Secreta**                    |
| Chave SMTP do Resend (sem variável)                   | Supabase Auth                                             | Só no painel do Supabase (Auth → SMTP)          | **Secreta**                    |

Regras:

- Nenhum valor desta tabela entra no repositório, em `.env` versionado, em log, em relatório ou em
  mensagem de PR. O `.gitignore` já ignora `.env*`, exceto `.env.example`.
- Variável com prefixo `VITE_` vai para o navegador: **nunca** coloque segredo nela. As três
  variáveis `RESEND_*` ficam **exclusivamente no ambiente de servidor**: `RESEND_API_KEY` é
  credencial secreta; `RESEND_FROM_EMAIL` e `RESEND_REPLY_TO` são configuração de servidor
  (endereços de e-mail, não credenciais).
- `RESEND_*` só passam a ser lidas quando o envio pela aplicação for implementado (seção 8.2); hoje
  nenhum código as usa.
- Os nomes com prefixo `LOVABLE_` ficam como estão por compatibilidade (seção 12).

## 5. Estado das migrations e pré-condições

**Estado das migrations:** até o merge `dbbe497`, a `main` tinha **21 migrations** no journal, de
`0000` a `0020`. A **0021** (`0021_remove_seed_demo_orgs_on_fresh_databases`) entra na `main` pelo
pull request da branch `db/0021-remove-seed-demo-orgs`, que substitui a branch de trabalho anterior
`db/0021-fresh-db-without-demo-seeds`. As **22 migrations** citadas neste documento são o estado
depois da integração da 0021. Antes de qualquer conexão, confirme no journal da `main` que a 0021
está presente (pré-condição 1).

Pré-condições, todas antes de qualquer conexão:

1. **Migration 0021 integrada à `main`.** A `0000_auth_orgs_memberships` insere as organizações de
   demonstração `org_marao` e `org_harbor`. Sem a 0021, o banco de produção nasceria com esses
   tenants fictícios.
2. **Painel do cliente com a marca Dinequora na `main`** (textos, títulos, e-mails e logotipo).
3. **Autenticação viável no Supabase próprio** (seção 6): decisão sobre o Google tomada e o PR de
   código correspondente integrado.
4. **Decisões do responsável registradas:**
   - hospedagem e domínio do aplicativo (seção 2);
   - caixa postal ou encaminhamento de `support@dinequora.com` confirmado (seção 8);
   - preços dos planos: `billing_plans` é semeada pela 0003 com valores **provisórios** (Starter
     8900, Growth 8300 por unidade, Enterprise sob contrato) e o Control Center tem valores fixos no
     código.
5. **Ensaio verde** num banco descartável, com o mesmo commit que será aplicado:
   `scripts/qa/security-suite.sh` (o job `security` da CI). Resultado esperado depois da integração
   da 0021: 22 migrations aplicadas, **0 organizações**, `check-migrations` em modo banco aprovado.
6. **Commit a aplicar identificado** (merge na `main`, de preferência com tag), registrado antes da
   aplicação.

## 6. Autenticação no Supabase próprio

**Dependência atual do Lovable Cloud Auth**

| Parte               | Situação no `dinequora-production`                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E-mail e senha      | Usa `supabase.auth` direto (`src/lib/auth/supabase-adapter.ts`): cadastro, login, reenvio de confirmação e recuperação de senha. **Funciona** no Supabase próprio, depois da configuração de Auth e SMTP (seções 7 e 8).                                                                   |
| Sessão no navegador | `brokeredPreviewStorage()` (`src/integrations/supabase/previewAuthStorage.ts`) só usa o broker do Lovable dentro do preview do editor Lovable; fora dele usa `localStorage`. **Funciona** no domínio de produção.                                                                          |
| Google              | `signInWithProvider` chama `lovable.auth.signInWithOAuth` (`@lovable.dev/cloud-auth-js`, arquivo gerado `src/integrations/lovable/index.ts`) e depois `supabase.auth.setSession`. O OAuth é feito pelo serviço gerenciado do Lovable Cloud: **não funciona** com o `dinequora-production`. |
| Botão do Google     | Ativo em `src/lib/auth/index.ts` (`{ id: "google", enabled: true }`): hoje aparece nas telas de login e cadastro e **falharia** em produção.                                                                                                                                               |
| Textos e nomes      | A mensagem de erro de `client.ts` cita "Lovable Cloud"; as variáveis `LOVABLE_*` mantêm o nome (seção 12).                                                                                                                                                                                 |

**Decisão necessária: OAuth Google**

- **Opção A — lançar só com e-mail e senha.** PR de código pequeno: desativar o Google em
  `src/lib/auth/index.ts`. Nada a configurar no Google Cloud. O Google pode entrar depois.
- **Opção B — manter o Google.** Exige:
  1. PR de código trocando `lovable.auth.signInWithOAuth` por `supabase.auth.signInWithOAuth`
     (`provider: "google"`, retorno em `/auth`), com testes do fluxo de retorno e do erro;
  2. projeto no Google Cloud com cliente OAuth, tela de consentimento com o nome **Dinequora** e o
     domínio verificado, e URI de redirecionamento autorizada
     `https://<project-ref>.supabase.co/auth/v1/callback`;
  3. provedor Google ativado no painel do Supabase com o Client ID e o Client Secret (o secret só no
     painel);
  4. teste ponta a ponta antes do lançamento.

Nas duas opções, o PR de código entra na `main` antes do deploy de produção. A remoção do pacote
`@lovable.dev/cloud-auth-js` e dos arquivos gerados fica para depois, com decisão própria.

## 7. Configuração no painel do Supabase (feita pelo responsável)

**Auth**

- [ ] Site URL = origem de produção do aplicativo (depende da hospedagem, seção 2).
- [ ] Redirect URLs somente das origens de produção (e de homologação, se houver), por exemplo
      `https://<app-domain>/**`. Sem `localhost`. O aplicativo usa `/auth` e
      `/reset-password?recovery=1`.
- [ ] "Confirm email" e "Secure email change" ativados.
- [ ] Proteção contra senhas vazadas e política de senha revisadas.
- [ ] SMTP do Resend configurado (seção 8.1).
- [ ] Modelos de e-mail com a marca Dinequora, a partir de `renderEmail()`
      (`src/lib/email-templates.ts`), em en-US e pt-BR.
- [ ] Provedor Google: somente na Opção B da seção 6.

**Banco e segurança**

- [ ] Senha do banco forte, guardada no cofre do responsável.
- [ ] SSL obrigatório ativado.
- [ ] Restrições de rede avaliadas (opcional).
- [ ] Data API com os schemas padrão (`public`); nada além disso exposto.

**Backups e capacidade**

- [ ] Backups diários do plano Pro conferidos.
- [ ] Recuperação a qualquer ponto no tempo (PITR, complemento pago) avaliada antes da entrada de
      dados reais de clientes.
- [ ] Compute Micro monitorado (CPU, memória e conexões) nas primeiras semanas.

**Nunca, neste projeto**

- Criar ou alterar tabelas, políticas ou funções pelo Table Editor ou pelo SQL Editor.
- Ligar ou desligar o Realtime de tabelas pelo painel (altera a publicação fora das migrations).
- Rodar `supabase db push`, `drizzle-kit push`, `drizzle-kit generate` ou `drizzle-kit introspect`.
- Executar à mão as órfãs `0010_fix_admin_list_platform_admins`,
  `0011_create_pos_sale_and_idempotency` ou `0012_enable_realtime_orders`
  (`migration-orphans.md`), nem as cópias em `docs/pending-migrations/`.

## 8. E-mail com o Resend

**Configuração oficial**

| Item             | Valor                      |
| ---------------- | -------------------------- |
| Domínio de envio | `send.dinequora.com`       |
| Remetente        | `hello@send.dinequora.com` |
| Reply-To         | `support@dinequora.com`    |

**Estado no Resend (2026-11-10)**

- `send.dinequora.com` **verificado**: os registros DNS obrigatórios estão validados.
- **Envio habilitado.**
- **Recebimento desabilitado**: nenhuma mensagem enviada a `hello@send.dinequora.com` é recebida.
- **Pendente:** confirmar uma caixa postal ou um encaminhamento para `support@dinequora.com`. Até
  isso estar confirmado e testado, respostas dos clientes não chegam a ninguém e o `Reply-To` não
  deve ser considerado ativo.
- Qualquer alteração futura de DNS exige autorização (seção 13).
- Esta configuração substitui os exemplos genéricos de `smtp-production-readiness.md` (que usa
  `notify.<domain>` e o nome antigo da marca).

### 8.1 SMTP do Resend para o Supabase Auth

E-mails de confirmação de conta, recuperação de senha e troca de e-mail, enviados pelo próprio
Supabase Auth. **Não exige código.**

- [ ] No painel do `dinequora-production` (Auth → SMTP): host `smtp.resend.com`, porta 465 (TLS
      implícito) ou 587 (STARTTLS), usuário `resend`.
- [ ] Senha = uma chave de API do Resend **exclusiva para o SMTP**, com permissão só de envio e
      restrita a `send.dinequora.com`. Fica só no painel do Supabase; não é variável de ambiente.
- [ ] Remetente `hello@send.dinequora.com`, nome do remetente `Dinequora`.
- [ ] Limite de envio do Auth ajustado ao volume esperado.
- [ ] O formulário de SMTP do Supabase Auth não tem campo de `Reply-To` (conferir no painel no
      momento da configuração). Por isso os modelos de e-mail devem indicar `support@dinequora.com`
      no texto como canal de contato.

### 8.2 API do Resend para e-mails da aplicação

Convites, aviso de convite aceito e avisos de segurança, enviados pelo servidor da aplicação.
**Ainda não implementado** (`email-delivery.md`): exige um PR de código próprio.

- [ ] Função de envio **somente no servidor**, chamada depois de `create_invitation`,
      `accept_invitation` e dos eventos de segurança auditados; destinatário e conteúdo derivados do
      banco, nunca da requisição.
- [ ] Na hospedagem, somente no ambiente de servidor:
  - `RESEND_API_KEY` — **credencial secreta**: chave **separada** da chave do SMTP, só de envio,
    restrita a `send.dinequora.com`;
  - `RESEND_FROM_EMAIL` = `hello@send.dinequora.com` — configuração de servidor;
  - `RESEND_REPLY_TO` = `support@dinequora.com` — configuração de servidor.
- [ ] Modelos a partir de `renderEmail()`, nos dois idiomas, escolhendo o idioma pelo
      `preferred_language` do destinatário.
- [ ] Registro de cada tentativa de envio, respeito à lista de supressão e nenhum segredo no corpo
      além do link de ação de uso único.
- [ ] Só depois do envio funcionar, mudar a interface para dizer "convite enviado".

## 9. Aplicação das migrations (operador, uma única vez)

**Conexão:** use o **Session pooler** (porta 5432) do painel. O Transaction pooler (porta 6543)
não serve para migrations. A conexão direta exige IPv6 ou o complemento de IPv4.

1. **Checkout limpo** do commit aprovado, numa worktree nova, seguido de `npm ci`.
2. **Conferência dos arquivos**, sem banco: `node scripts/qa/check-migrations.mjs` → aprovado.
3. **Conferência de que o banco está vazio** (primeira conexão; autorização própria), em sessão
   somente leitura:

   ```sql
   begin transaction read only;
   select count(*) from pg_tables where schemaname = 'public';  -- esperado: 0
   select to_regnamespace('drizzle');                           -- esperado: null
   rollback;
   ```

   Se qualquer resultado for diferente, **pare**: o banco não está vazio.

4. **Aplicação** (autorização própria). Em Git Bash, sem gravar a conexão no histórico nem em
   arquivo:

   ```bash
   read -rs LOVABLE_DB_MIGRATION_URL && export LOVABLE_DB_MIGRATION_URL
   npx drizzle-kit migrate
   unset LOVABLE_DB_MIGRATION_URL
   ```

   **Transação** — conferido no código das versões fixadas (`drizzle-kit` 0.31.11,
   `drizzle-orm` 0.45.4, driver `postgres` 3.4.9; o pacote `pg` não está instalado):
   `drizzle-kit migrate` chama `drizzle-orm/postgres-js/migrator`, que executa
   `PgDialect.migrate`; esse método aplica **todas as migrations pendentes e os registros em
   `drizzle.__drizzle_migrations` dentro de uma única transação** (`session.transaction`, que no
   driver `postgres` é `client.begin`). Se uma falhar, nenhuma fica aplicada. Ressalvas:

   - o schema `drizzle` e a tabela `__drizzle_migrations` são criados **antes** da transação e
     permanecem depois de uma falha (vazios). Isso é esperado e não indica migration aplicada;
   - quais migrations estão pendentes é decidido pelo campo `when` do journal (comparado com o
     último `created_at` registrado), não pelo hash. Por isso `check-migrations` exige `when`
     sempre crescente;
   - a garantia vale enquanto nenhuma migration contiver comandos que não rodam dentro de transação
     (`COMMIT`, `CREATE INDEX CONCURRENTLY`, `VACUUM` e semelhantes). As migrations 0000 a 0020 e a
     0021 não contêm nenhum deles.

   Em caso de falha, **não reexecute às cegas**: registre o erro e analise antes.

5. **Verificação**, somente leitura:
   - `DB_URL` com a mesma conexão e `node scripts/qa/check-migrations.mjs` → aprovado: 22 migrations
     aplicadas (estado esperado depois da integração da 0021) com os hashes registrados, nenhuma
     órfã, RLS e funções conforme a política;
   - `select count(*) from public.organizations;` → 0;
   - `select tablename from pg_publication_tables where pubname = 'supabase_realtime';` →
     `order_items`, `orders`;
   - `select id from public.billing_plans order by 1;` → `enterprise`, `growth`, `starter`;
   - Security Advisor e Performance Advisor do painel revisados.

6. **Registro** (sem segredos): data, commit aplicado, operador e resultado de cada verificação.

## 10. Depois das migrations

1. **SMTP funcionando** (seção 8.1): o primeiro administrador precisa confirmar o e-mail.
2. **Primeiro administrador da plataforma**, uma única vez, pelo procedimento de
   `platform-admin-bootstrap.md`.
3. **Onboarding real do MARAO**, conforme `data-layers-and-marao-production.md` §2: organização
   nova pelo fluxo do aplicativo, slug gerado (não `org_marao`), unidades com dados reais, plano
   compatível com três unidades.
4. **Deploy** do aplicativo na hospedagem decidida, com as variáveis da seção 4.
5. **Testes de fumaça** combinados com o responsável: login de cada perfil (e do Google, na Opção
   B), idioma e tema por usuário, uma venda de teste combinada, Cozinha recebendo pedidos em tempo
   real, e-mails de confirmação e recuperação recebidos com o remetente correto.
6. **Acompanhamento** das primeiras 48 horas: envios de e-mail, alertas de observabilidade, uso
   do compute.

## 11. Como voltar atrás

- **Antes de existirem dados reais:** o caminho limpo é recriar o projeto (banco vazio) e repetir
  a seção 9. Decisão do responsável.
- **Depois de existirem dados reais:** só restauração de backup. Correções de esquema sempre por
  migration nova; uma migration aplicada nunca é editada (`migration-policy.md`).

## 12. Identificadores mantidos por compatibilidade

A marca comercial e tudo o que o cliente vê é **Dinequora**. Estes identificadores internos ficam
como estão, **sem substituição global**, até um plano de rebranding próprio
(`phase0-rebranding-plan.md`):

- chaves `servora.*` no `localStorage` e no `sessionStorage`;
- variável de sessão do banco `servora.audit_location` (migration 0018) e a tag
  `0010_servora_types`, que nunca muda;
- contas de demonstração `@servora.test`;
- nomes de variáveis `LOVABLE_*` e `VITE_SUPABASE_*`;
- o endereço fictício `support@servora.app` existia só nos chamados de demonstração de
  `support-service.ts`, removido por não ter uso. O contato de suporte real virá de
  `VITE_SUPPORT_EMAIL`, lido por `platform-contact.ts` — que **ainda não é usado por nenhuma
  tela**: hoje o app não exibe contato de suporte. Valor previsto: `support@dinequora.com`, só
  depois que a caixa postal ou o encaminhamento for confirmado (seção 8);
- nomes das pastas locais das worktrees.

## 13. Autorizações exigidas

Cada item abaixo exige autorização explícita do responsável, dada para aquela etapa:

1. Primeira conexão ao `dinequora-production` (conferência somente leitura).
2. Aplicação das migrations.
3. Configuração de SMTP, modelos de e-mail e provedores de login.
4. Novos registros ou alterações de DNS (`dinequora.com`, `send.dinequora.com` e o domínio do
   aplicativo).
5. Bootstrap do primeiro administrador da plataforma.
6. Deploy do aplicativo.
7. Qualquer operação com dados reais de clientes.

## Referências

- `docs/operations/migration-policy.md`: política SQL-first e histórico imutável.
- `docs/operations/migration-orphans.md`: as três órfãs.
- `docs/operations/data-layers-and-marao-production.md`: camadas de dados e MARAO em produção.
- `docs/operations/platform-admin-bootstrap.md`: primeiro administrador.
- `docs/operations/smtp-production-readiness.md` e `email-delivery.md`: e-mail (exemplos genéricos;
  a configuração oficial está na seção 8).
- `docs/operations/phase0-rebranding-plan.md`: rebranding Servora → Dinequora.
- `scripts/qa/check-migrations.mjs` e `scripts/qa/security-suite.sh`: conferência e ensaio.
