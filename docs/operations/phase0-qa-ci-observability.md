# Fase 0 — QA isolado, CI, dados reais × demonstração e observabilidade

## 1. Ambientes

| Ambiente                                                             | Portas                 | Uso                                                  | Pode receber escrita de teste?                                                        |
| -------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Demonstração comercial (`supabase/`, projeto `ilemvaquootxarmisdjb`) | 543xx                  | MARAO, Harbor, Aurora, Org Alpha/Beta                | **Não**. A matriz de permissões recusa 54321 (só com `ALLOW_DEMO_WRITES=1` explícito) |
| QA descartável (`scripts/qa/supabase`, projeto `dq-rebuild`)         | 553xx                  | Tenant **Dinequora QA (isolated)** + **QA Tenant B** | Sim                                                                                   |
| CI                                                                   | 553xx dentro do runner | Stack novo a cada execução                           | Sim (efêmero)                                                                         |

O tenant de QA é criado por `scripts/qa/seed-qa-org.mjs` usando as mesmas RPCs da interface: duas lojas
(QA Downtown / QA Riverside), conta para cada perfil do sistema (gerente, caixa, cozinha, estoque,
financeiro, além do proprietário e do admin da plataforma) e uma segunda organização com estoque, custo e
venda próprios para testar isolamento. Senhas são geradas e gravadas só no `CREDS_FILE` (fora do repositório).

## 2. Pipeline (`.github/workflows/ci.yml`)

- **quality**: `tsc --noEmit`, ESLint, Vitest, `npm run build`, `check-migrations` (arquivos).
- **security**: Supabase novo → `drizzle-kit migrate` do zero → `check-migrations` com banco (hash LF) →
  fixtures SQL (`reconstructed_operations`, que reúne as antigas `hardening/purchases`, em transação com ROLLBACK e ids próprios) → seed do QA → `permission_matrix.mjs` (144 verificações:
  seis perfis, escopo de loja, isolamento entre organizações, custos de estoque, admin da plataforma).
- Sem segredos, sem deploy, sem acesso a projeto hospedado.
- O Supabase CLI não é dependência do projeto: o job **security** instala a versão fixa **3.0.0** com
  `supabase/setup-cli@v1` e chama `supabase` direto (nada de `npx`, que no runner não acharia o CLI).
  Localmente, use a mesma versão no PATH; a suíte não depende de pacotes npm globais.
- **Para bloquear merge** é preciso ativar _branch protection_ no GitHub exigindo `ci / quality` e
  `ci / security` (ação no GitHub, pendente de autorização).

Ensaio local equivalente (stack novo, checkout LF): todas as etapas passaram. Com uma regressão
injetada (`assert_permission` desativada) a matriz saiu com código 1 e 9 falhas (“UNEXPECTEDLY ALLOWED”);
após restaurar a função, 144/144.

## 3. Dados reais × demonstração

Mecanismo: `organizations.is_demo` → `org.fictional` no cliente (`org-service.ts`). O backend já recusa
simulação em organizações reais (`simulation_forbidden`).

Corrigido na Fase 0:

| Tela                                    | Antes                                                                                             | Agora                                                                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unidades                                | Vendas/Pedidos/Crescimento sintéticos (`computeKpis`) e selo “Demo” para **qualquer** organização | Demo: igual a antes. Real: vendas líquidas gravadas dos últimos 30 dias por loja, pedidos e variação vs. 30 dias anteriores (mesma regra de venda dos Relatórios); exige `dashboard.financials` ou `finance.view`; sem permissão, o bloco não aparece |
| Sino de notificações (todas as páginas) | 5 alertas fixos e ponto “não lido” sempre aceso                                                   | Só em organizações demo; real mostra “Nenhuma notificação no momento”                                                                                                                                                                                 |
| KDS                                     | Primeira renderização lia tickets locais (inclusive simulados) do navegador                       | Real: começa vazio e mostra só pedidos do banco                                                                                                                                                                                                       |
| Vendas em espera (PDV)                  | Sem validade, sem validação; nomes de clientes ficavam no terminal indefinidamente                | Validade de 24 h; vencidas, malformadas, ilegíveis ou de outra organização vão para `servora.quarantine.pos.suspended.<org>` (nada é apagado); chave original mantida                                                                                 |

Pendentes (registrados, não alterados nesta fase):

- **MARAO BURGERS** está `is_demo = true` no banco (semente da `0000` + `0001`), então vê o painel sintético; o arquivo `tenants.ts` a descreve como real. Decisão de negócio necessária (ver reconciliação §3.4).
- **Aurora Table Co. (Demo)** está `is_demo = false`: vê só dados gravados (que são dados de demonstração inseridos por fluxos reais). Coerente com o objetivo de demonstrar o produto real; o nome contém “(Demo)”.
- `org-service.ts` mescla conteúdo empacotado de `tenants.ts` (logo, categorias) a organizações cujo slug coincide (`org_marao`, `org_harbor`) sem checar `is_demo`.
- Fornecedores legados com `orgId: "default"` em `servora_suppliers_<org>` ainda podem aparecer em navegadores que já os têm.
- Código morto com `orgId === "demo"` (orders/inventory/recipes/finance/suppliers) nunca executa; remover numa limpeza.
- Preço de uma venda retomada da espera é o do momento em que foi suspensa; o servidor recalcula o total cobrado, mas o recibo mostra o valor do cliente. Tratar na Fase 1 (recalcular contra o cardápio ao retomar).

## 4. Observabilidade (`src/lib/observability.ts`)

- **Logs estruturados**: uma linha JSON por evento (`ts`, `level`, `event`, `runtime`, `scope`, `data`, `error`).
- **Escopo**: organização, loja, papel e id do usuário anexados automaticamente (registrados pelo `WorkspaceProvider`; limpos no logout). Sem nome, e-mail ou outros dados pessoais. No servidor o escopo fica vazio (nunca é compartilhado entre requisições).
- **Captura**: boundary raiz (crítico), boundary de rota (antes não registrava nada), erros globais do navegador e promessas rejeitadas, falhas de requisição/SSR/middleware no servidor (crítico, com método e caminho, sem query string), falha ao fechar/cancelar venda no PDV (crítico, exceto rejeições de regra de negócio como estoque insuficiente ou permissão negada), falha de busca do KDS.
- **Proteção de dados**: chaves sensíveis (senha, token, authorization, apikey, cookie, sessão, cartão, CVV, IBAN, SSN…) viram `[REDACTED]`; JWT, Bearer, chaves Supabase/Stripe, números de cartão válidos (Luhn), parâmetros de URL com token e e-mails são mascarados também dentro de mensagens e stacks — inclusive no `console.error` global do servidor.
- **Alertas críticos**: `registerAlertSink()` com deduplicação por impressão digital do erro (5 min) e isolamento de falhas do destino. **Nenhum destino está configurado**: nada sai do processo até que um provedor (ex.: Sentry, webhook de plantão) seja escolhido e autorizado.
- Testes: `src/test/observability.test.ts` (9).
