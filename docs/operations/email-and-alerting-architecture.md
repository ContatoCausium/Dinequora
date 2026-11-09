# E-mail de suporte, alertas e captura de exceções — arquitetura

Status: **preparado, desativado**. Nenhuma credencial, URL ou endereço real foi configurado.
Nada sai do servidor ou do navegador até que as variáveis abaixo sejam definidas com autorização.

## Pontos de configuração

| Necessidade                                                                     | Variável / ponto de extensão                                                                                                                                          | Onde                 | Padrão                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------- |
| Endereço público de suporte (previsto: caixa de suporte Dinequora, a confirmar) | `VITE_SUPPORT_EMAIL` → `supportEmail()` em `src/lib/platform-contact.ts`                                                                                              | navegador            | vazio = nenhum endereço exibido |
| Alertas de falhas críticas                                                      | `OBSERVABILITY_ALERT_WEBHOOK_URL` (https) + `OBSERVABILITY_ENVIRONMENT` → `configureObservability()` em `src/lib/observability-config.ts`, chamado em `src/server.ts` | servidor             | desativado                      |
| Captura de exceções (provedor)                                                  | `registerErrorReporter()` em `src/lib/observability.ts`                                                                                                               | servidor e navegador | nenhum                          |
| Destinos adicionais de alerta                                                   | `registerAlertSink()`                                                                                                                                                 | servidor             | nenhum                          |
| Envio de e-mails transacionais                                                  | `src/lib/email-templates.ts` (modelos bilíngues prontos; nenhum envio) + `docs/operations/email-delivery.md` / `smtp-production-readiness.md`                         | —                    | sem provedor                    |

Modelo de variáveis: `.env.example` (versionado, sem valores). `.env` nunca é versionado (`.gitignore`).

## Fluxo de um erro crítico

1. Um ponto de captura (boundary raiz, falha de requisição/SSR, falha ao fechar venda no PDV…) chama `captureError(…, { critical: true })`.
2. `observability.ts` monta o registro com escopo (organização, loja, papel, usuário) e **redige** segredos e dados pessoais.
3. A linha JSON vai para o log do processo (sempre).
4. Reporters registrados (provedor de exceções) recebem todo erro; alert sinks recebem só críticos, com deduplicação de 5 minutos por impressão digital.
5. Com `OBSERVABILITY_ALERT_WEBHOOK_URL` definido, o webhook recebe `{ source, environment, text, record }` via POST (timeout 3 s; falhas do destino nunca afetam o app). A URL nunca é registrada em log.

## Para ativar (cada item exige decisão/autorização)

1. **Suporte:** confirmar domínio e caixa; definir `VITE_SUPPORT_EMAIL` no ambiente de build. Trocar também os textos do rebranding (`phase0-rebranding-plan.md`).
2. **Alertas:** escolher o destino (ex.: canal de incidentes via webhook de entrada, PagerDuty/Opsgenie, relay interno); criar o webhook no provedor; definir as duas variáveis **no servidor** (nunca com prefixo `VITE_`, que expõe ao navegador).
3. **Exceções:** escolher provedor (ex.: Sentry); adicionar um adaptador que chame `registerErrorReporter` com o DSN vindo de variável de servidor; revisar a política de dados (o registro já chega redigido).
4. **Erros do navegador no servidor** (opcional): endpoint autenticado que receba registros redigidos do cliente e os repasse aos reporters; com limite de taxa.
5. Testes de aceite: `src/test/observability.test.ts` e `src/test/observability-config.test.ts` (sem variável = nada enviado; https obrigatório; corpo redigido; destino com falha não quebra o app).
