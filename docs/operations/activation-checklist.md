# Checklist de ativação: do que está na main até o Preview e a produção

Tudo abaixo **depende de autorização expressa** (documento mestre: nenhuma migration hospedada, deploy ou
ligação de módulo para organização real sem autorização específica). Nenhum passo foi executado.
Estado em 27/11/2026: a main tem as migrations **0037 a 0046**; o Supabase do Client Preview e o Worker
continuam no build anterior (634bc38); todos os módulos novos estão **desligados** em todas as
organizações.

## 1. Migrations novas (aplicar em ordem, uma vez)

| Migration | O que faz                                                                        | Atenção ao aplicar                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0037      | Mesas e setores (`table_service`)                                                | aditiva                                                                                                                                                          |
| 0038      | Sessões, comandas e rodadas; baixa de estoque no envio à cozinha                 | aditiva                                                                                                                                                          |
| 0039      | Pagamento por comanda, gorjeta, troco, estorno; `payments.method` aceita `mixed` | redefine `cancel_order_with_reversal`                                                                                                                            |
| 0040      | Assistente de IA (`ai_assistant`, `assistant.use`, `assistant_usage`)            | aditiva; nada é enviado sem chave                                                                                                                                |
| 0041      | Motivo do estorno só para quem pode estornar                                     | `select *` em `dining_check_payments` passa a ser recusado (o app não usa)                                                                                       |
| 0042      | `menu_item_sales` (engenharia de cardápio)                                       | só leitura                                                                                                                                                       |
| 0043      | Endurecimento das funções de administrador                                       | **antes:** confirmar que nenhum admin de plataforma é membro de organização cliente (a regra nova recusa no próximo vínculo; vínculos antigos não são desfeitos) |
| 0044      | `inventory_consumption` e índice em `inventory_movements`                        | o índice segura um lock SHARE enquanto é criado; tabela pequena hoje                                                                                             |
| 0045      | `sales_tax_summary` (relatório de imposto)                                       | só leitura                                                                                                                                                       |
| 0046      | `tips_by_server` (gorjetas por garçom)                                           | só leitura                                                                                                                                                       |

## 2. Client Preview (`docs/operations/client-preview.md`)

1. **Inspecionar (só leitura)**, §5.7: `PREVIEW_DB_OPERATION=inspect` com a confirmação
   `client-preview:db-inspect:client-preview:<ref>`. Deve responder estado `preview`.
2. **Migrar**: `PREVIEW_DB_OPERATION=migrate` com `client-preview:db-migrate:client-preview:<ref>`.
   Aplica 0037–0046 pelo mesmo `drizzle-kit migrate` da CI, com TLS verificado e bloqueio de produção por
   nome. Depois, `inspect` de novo.
3. **Build e deploy do Worker** do commit aprovado da main, §3 e §4 (perfil `client-preview`, checagem
   do bundle), com `preview_urls` desligado (§7a).
4. **Smoke (só leitura)** e **verify**, §5.4. Ordem de uma publicação: deploy → smoke → reset → verify.
5. **Ligar módulos na organização de demonstração** pelo Control Center › organização › Módulos:
   `table_service` (Mesas). `ai_assistant` só depois do passo 3 abaixo.
6. Conferir à mão no Preview: sentar mesa, enviar rodada, pagar por pessoa, estornar, histórico, imprimir
   conta, engenharia de cardápio, previsão de compras, alertas.

## 3. Assistente de IA (quando decidirem)

- Segredo do Worker `ANTHROPIC_API_KEY` (conta da empresa). Opcional: `ASSISTANT_MONTHLY_TOKEN_CAP`
  (padrão 2.000.000 de tokens por organização por mês) e `ASSISTANT_PER_MINUTE_LIMIT` (padrão 6 perguntas
  por pessoa por minuto).
- Ligar `ai_assistant` por organização no Control Center. Owners têm `assistant.use`; managers por
  padrão; staff só por concessão.
- Ver `docs/operations/ai-assistant.md` (o que é enviado ao modelo e o que nunca é).

## 4. Produção

Ainda não existe ambiente de produção (Fase 3 do plano): projeto Supabase e Worker próprios, domínio do
app, backup com restauração ensaiada, alertas, e-mail transacional com domínio verificado. A mesma
sequência de migrations vale para ele, aplicada pelo runner normal depois da autorização.

## 5. Decisões abertas (não bloqueiam o Preview)

- **Preço:** `billing_plans` (US$ 89 / 83 por loja) diverge do site (implantação + mensalidade).
- **Processador de pagamento** (Stripe Terminal, Square, Adyen): hoje o POS só registra o pagamento.
- **Gorjeta e taxa de serviço:** usado 15/18/20% sugeridos sobre o subtotal, sem taxa de serviço.
- **MFA obrigatório para donos:** hoje é opcional.
- **Auditoria para o admin da plataforma:** ele lê valores de vendas, pagamentos e gorjetas dos
  restaurantes na auditoria estruturada (decisão de 0035); e notas internas do operador aparecem na
  auditoria do restaurante. Ver `docs/operations/platform-admin-hardening.md`.
- **Imposto:** alíquota única por loja; regras por jurisdição dependem de contador (Fase 7).
