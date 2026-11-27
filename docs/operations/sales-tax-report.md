# Relatório de imposto sobre vendas (migration 0045)

Painel **Imposto sobre vendas (sales tax)** no topo de **Financeiro › Relatórios & exportações** (plano,
Fase 7, "relatórios fiscais"). Por loja e por mês (fuso da loja), para os últimos 3, 6 ou 12 meses:

- **pedidos**, **vendas tributáveis** (subtotal − descontos), **imposto cobrado** e **alíquota efetiva**
  (imposto ÷ vendas tributáveis);
- **CSV** com as mesmas colunas e o total com imposto, para o contador.

Ficam de fora os pedidos **cancelados** e os **simulados** (que só existem em organizações de
demonstração). Gorjeta não é venda e não entra. A alíquota não é presumida: é o imposto que cada pedido
registrou, com a alíquota da loja no momento da venda.

**Limite conhecido:** o Dinequora aplica uma alíquota única por loja (Fase 7 do plano: regras por
jurisdição, tipo de produto, consumo no local × para viagem e imposto em reembolso dependem de contador).
O painel diz para conferir com o contador antes de declarar.

## Banco: `sales_tax_summary(org, lojas, meses)` (0045)

Leitura agregada, `SECURITY INVOKER`: o RLS de quem lê decide o que conta (as mesmas políticas do
histórico de pedidos). Nenhuma escrita, nenhuma tabela, nenhum privilégio novo além de `EXECUTE` para
`authenticated`.

Teste: passo 5u da suíte de segurança (`scripts/security/sales_tax_integrity.mjs`, 9 checagens: soma por
mês com desconto, cancelado e simulado fora, mês anterior separado, janela de 3 e 6 meses, loja de outra
organização, isolamento entre organizações, anon, SECURITY INVOKER).

Conferido no app local em 27/11: QA Downtown 6 pedidos, US$ 40,75 tributáveis, US$ 2,53 de imposto
(alíquota da loja 6,25%, efetiva 6,2% pelo arredondamento por pedido); QA Riverside 3 pedidos,
US$ 16,50, US$ 1,47 (8,875%). Batem com a soma direta no banco.

Rollback (migration NOVA): `drop function public.sales_tax_summary(uuid, uuid[], integer);`
