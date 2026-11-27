# Engenharia de cardápio (migration 0042)

Seção **Engenharia de cardápio** em Insights. Cada prato vendido no período da página (7, 30 ou 90
dias, na loja do seletor ou em todas) é classificado pela matriz de Kasavana & Smith:

| Classe         | Vende | Margem por unidade | O que a tela sugere                     |
| -------------- | ----- | ------------------ | --------------------------------------- |
| Estrela        | muito | alta               | manter qualidade e destaque             |
| Burro de carga | muito | baixa              | rever porção, custo da ficha ou preço   |
| Enigma         | pouco | alta               | dar destaque, sugerir na mesa, renomear |
| Cão            | pouco | baixa              | refazer ou tirar do cardápio            |

- **Popular**: mix (participação nas unidades) de pelo menos 70% de uma divisão igual (1/N).
- **Margem alta**: margem de contribuição por unidade (preço médio vendido − custo da ficha por porção)
  de pelo menos a média ponderada pelas unidades dos pratos classificados.
- Só entram pratos **com custo de ficha técnica**. Prato sem ficha, ou com ingrediente sem custo, fica
  numa linha à parte ("não classificado"); **nenhum custo é estimado**.
- Preço médio = vendas ÷ unidades, com opções, antes de descontos do pedido e do imposto. Custo = ficha
  técnica ATUAL da loja onde o prato foi vendido (ingredientes de opções não estão na ficha).
- Menos de dois pratos com custo: a tela mostra os números sem classificar.

Código: `src/lib/menu-engineering.ts` (método), `src/components/intelligence/menu-engineering-panel.tsx`
(tela), `fetchMenuItemSales` em `src/lib/operational.functions.ts`.

## Banco: `menu_item_sales(org, lojas, dias)` (0042)

Leitura agregada, `SECURITY INVOKER`: as políticas de RLS de quem lê decidem o que conta (as mesmas do
histórico de pedidos). Soma unidades, vendas e pedidos por produto e loja, pedidos não cancelados, nos
últimos N dias locais de cada loja (fuso da loja, como `ledger_day_totals`). Nenhuma escrita, nenhuma
tabela, nenhum privilégio novo além de `EXECUTE` para `authenticated`.

Teste: passo 5q da suíte de segurança (`scripts/security/menu_item_sales_integrity.mjs`, 10 checagens:
contagem, cancelados fora, janela de dias, filtro de loja de outra organização, isolamento entre
organizações, anon, SECURITY INVOKER).

Rollback (uma migration NOVA): `drop function public.menu_item_sales(uuid, uuid[], integer);`.
