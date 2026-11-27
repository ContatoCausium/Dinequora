# Previsão de compras (migration 0044)

Painel **Previsão de compras** no topo da aba "Pedidos de compra" da página de Estoque. Para a loja do
seletor (ou todas), lista os itens a comprar para cobrir os próximos **7 ou 14 dias**, com base no que as
vendas consumiram de verdade nos **últimos 30 dias**:

- **uso por dia** = consumo de vendas na janela ÷ 30;
- **dura** = estoque atual ÷ uso por dia;
- **comprar** = uso por dia × dias de cobertura + mínimo − estoque, só quando positivo, arredondado
  para cima (unidade inteira para `units` e `pack`, 0,1 para peso e volume).

Os itens que acabam primeiro aparecem no topo, com o fornecedor cadastrado. Um item sem consumo de vendas
no período **não recebe sugestão** (não há de onde projetar). Se estiver no mínimo ou abaixo dele, aparece
numa linha à parte para não ser esquecido. **Nenhuma quantidade é inventada.**

Código: `src/lib/purchase-forecast.ts` (cálculo), `src/components/inventory/purchase-forecast-panel.tsx`
(tela), `fetchInventoryConsumption` em `src/lib/operational.functions.ts`.

## Banco: `inventory_consumption(org, lojas, dias)` (0044)

Leitura agregada, `SECURITY INVOKER`: o RLS de quem lê decide o que conta (`inventory.view` nas lojas
que a pessoa acessa). Consumo = baixas de `sale` menos os `reversal` cujo movimento estornado é uma venda,
na unidade do item. Ajustes, perdas, transferências e recebimentos **não** são consumo. Janela: últimos N
dias locais de cada loja (fuso da loja, como 0031 e 0042).

A migration também cria o índice `inventory_movements_store_date (org_id, location_id, created_at)`. Antes,
a tabela só tinha índices por pedido e por estorno. O `CREATE INDEX` segura um lock SHARE enquanto
constrói; a tabela é pequena hoje e o `lock_timeout` limita a espera.

Teste: passo 5t da suíte de segurança (`scripts/security/inventory_consumption_integrity.mjs`, 9
checagens: venda menos estorno de venda, estorno de ajuste não conta, ajuste não conta, janela de 30 e
60 dias, loja de outra organização, isolamento entre organizações, anon, SECURITY INVOKER).

Conferido no app local em 27/11 com dados reais: lata de refrigerante, 9 vendidas em 30 dias (0,3/dia),
191 em estoque, mínimo 195 por um instante → "comprar 7 un.", "dura 636 dias"; mínimo devolvido a 10.

Rollback (migration NOVA): `drop function public.inventory_consumption(uuid, uuid[], integer);`
`drop index public.inventory_movements_store_date;`
