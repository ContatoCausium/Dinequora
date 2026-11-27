# Alertas em Insights: queda de vendas e fornecedor que encareceu

Dois diagnósticos novos em **Insights › Diagnósticos operacionais** (plano, Fase 5, caso 4), calculados
sem modelo de IA e só com dados que a página já lê (`src/lib/smart-alerts.ts`):

- **Queda de vendas:** a receita bruta do período (7, 30 ou 90 dias) contra o período anterior de mesmo
  tamanho. Alerta quando caiu **15% ou mais**; nível alto a partir de 30%. A comparação só existe quando a
  leitura do razão está completa e o período anterior teve receita (a mesma regra do "vs anterior" do KPI).
- **Fornecedor encareceu:** para cada item de estoque, o preço unitário no pedido de compra mais recente
  contra o pedido anterior. Contam pedidos enviados, recebidos ou parcialmente recebidos; rascunhos e
  cancelados não são preços combinados. Alerta quando subiu **10% ou mais**; nível alto a partir de 25%.
  Mostra os três maiores aumentos com item, fornecedor, preço antes → agora e a variação.

Com um único pedido de um item não há tendência, e nada é estimado. Quem não pode ler pedidos de compra
(RLS) simplesmente não recebe o alerta de fornecedor.

Testes: `src/test/smart-alerts.test.ts`.
