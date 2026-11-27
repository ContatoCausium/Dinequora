# Insights e compras: guia rápido

Para donos e gerentes. Todo número vem do que foi registrado no Dinequora (vendas, fichas técnicas,
estoque, pedidos de compra). Nada é estimado: quando falta dado, a tela avisa.

## Insights

Escolha o período (7, 30 ou 90 dias) e a loja (ou todas).

- **Receita, resultado líquido, CMV, margem bruta e estoque baixo**, com a variação contra o período
  anterior.
- **Diagnósticos operacionais:** CMV contra a referência de 28–32%, estoque baixo, falta de fichas
  técnicas, e dois alertas:
  - **Queda de vendas**: receita 15% ou mais abaixo do período anterior de mesmo tamanho.
  - **Fornecedor encareceu**: o preço unitário de um item no último pedido de compra está 10% ou mais
    acima do pedido anterior. Mostra item, fornecedor, preço antigo e novo.
- **Respostas rápidas:** toque numa sugestão ou digite uma pergunta. Funcionam sem IA e mostram a
  evidência e o método de cada número. "O que eu preciso comprar esta semana?" e "Quais pratos devo
  promover?" usam as duas ferramentas abaixo.

## Engenharia de cardápio (Insights)

Cada prato vendido no período, classificado por quanto vende (participação nas unidades) e quanto deixa
por unidade (preço médio vendido menos o custo atual da ficha):

| Classe         | Vende | Margem | O que fazer                                 |
| -------------- | ----- | ------ | ------------------------------------------- |
| Estrela        | muito | alta   | manter qualidade e destaque no cardápio     |
| Burro de carga | muito | baixa  | rever porção, custo da ficha ou preço       |
| Enigma         | pouco | alta   | dar destaque, sugerir na mesa, mudar o nome |
| Cão            | pouco | baixa  | refazer ou tirar do cardápio                |

Prato sem custo de ficha aparece à parte e não é classificado: cadastre a ficha em **Cardápio e fichas**.
São precisos pelo menos dois pratos com custo e vendas para classificar.

## Previsão de compras (Estoque › Pedidos de compra)

O que comprar para cobrir os próximos **7 ou 14 dias**, pelo que as vendas consumiram de verdade nos
últimos 30 dias:

- **Uso / dia** = o que as vendas tiraram do estoque em 30 dias ÷ 30 (ajustes e perdas não contam);
- **Dura** = estoque ÷ uso por dia;
- **Comprar** = uso por dia × dias + mínimo − estoque, arredondado para cima.

Os itens que acabam primeiro ficam no topo, com o fornecedor. Itens no mínimo ou abaixo sem uso em vendas
aparecem à parte, sem quantidade: confira à mão.

## O assistente de IA (quando o restaurante ligar)

Pergunte em português ou inglês ("por que meu CMV subiu esta semana?"). Ele lê só o que você pode ver,
responde com os seus números registrados (vendas, mais vendidos, engenharia de cardápio, previsão de
compras, estoque baixo) e nunca altera nada. Pode errar: confira números importantes em Financeiro e
Relatórios.
