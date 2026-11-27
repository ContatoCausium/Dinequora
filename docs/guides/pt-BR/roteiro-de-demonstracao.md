# Roteiro de demonstração (20 a 25 minutos)

Para o Filipi e o Matheus apresentarem o Dinequora a um restaurante. Use a organização de demonstração do
Client Preview, **com o módulo Mesas ligado** (Control Center › organização › Módulos) e as migrations 0037
em diante aplicadas (`docs/operations/activation-checklist.md`). Nunca use dados de um cliente real.

**Regras da conversa:** mostre o que existe e diga o que ainda não existe. O Dinequora **registra** os
pagamentos; ainda **não cobra cartão** (processador não escolhido). O assistente de IA só aparece se a chave
estiver configurada; sem ela, mostre as Respostas rápidas (sem IA).

## 1. Abertura (2 min)

"O Dinequora junta salão, cozinha, estoque, fichas técnicas e financeiro num lugar só, e todo número que
aparece vem do que foi registrado: nada é estimado." Mostre a **Visão geral** com o seletor de lojas.

## 2. Salão e comandas (7 min)

1. **Mesas**: setores, mesas e status. Sente 3 pessoas numa mesa.
2. Abra uma **segunda comanda** na mesma mesa ("Ana") para mostrar contas separadas.
3. Envie uma rodada para a cozinha em cada comanda. Abra o **KDS** em outra aba: o pedido aparece com a
   mesa e o nome da comanda. Diga que o estoque baixa **no envio**.
4. **Imprimir conta**: pré-conta com sugestão de gorjeta (15/18/20% sobre o subtotal, costume americano).
5. **Pagamento**: divida a primeira comanda **por pessoas**, receba em cartão com gorjeta 18%; a segunda
   em dinheiro, com troco. A mesa vai para Limpeza sozinha quando a última comanda fecha.
6. **Histórico** de uma comanda: quem fez o quê e quando.
7. Painel **Hoje**: recebido por forma de pagamento, gorjetas por garçom, **Imprimir fechamento**.

## 3. Cardápio e custo (4 min)

1. **Cardápio e fichas**: uma ficha técnica com o custo por porção.
2. **Insights › Engenharia de cardápio**: Estrela, Burro de carga, Enigma e Cão, com o que fazer em cada
   caso. Se um prato não tem ficha, ele aparece à parte: "o sistema não inventa custo".
3. **Respostas rápidas**: clique em "Quais pratos devo promover?".

## 4. Estoque e compras (4 min)

1. **Estoque › Pedidos de compra › Previsão de compras**: quanto comprar para 7 ou 14 dias pelo consumo real
   das vendas. Clique em **Pedir** numa linha: o pedido abre preenchido.
2. **Insights › Diagnósticos**: alerta de fornecedor que encareceu (se houver dois pedidos do mesmo item).

## 5. Financeiro (3 min)

1. **Financeiro › Relatórios & exportações**: **imposto sobre vendas** por loja e mês com CSV para o
   contador, e **gorjetas por garçom** com dinheiro separado, para a folha.
2. Diga que as regras fiscais por jurisdição ainda dependem do contador (uma alíquota por loja hoje).

## 6. Segurança e controle (2 min)

- Permissões por papel e por loja; cada restaurante só vê os próprios dados (varredura automática de
  isolamento em toda tabela, a cada mudança).
- Verificação em duas etapas em **Configurações › Segurança**.
- Módulos ligados por restaurante pelo Control Center.

## 7. Fechamento (2 min)

Pergunte: quantas lojas, quantas mesas, se usam KDS, qual maquininha usam hoje, se querem o assistente de
IA. Anote para a proposta. **Preços:** use os do site até a decisão do modelo de preço ser fechada.
