# Salão, etapa 3: pagar e fechar comandas (migration 0039)

## O que é

Última etapa de "Mesas e comandas". Na comanda aberta da mesa, o garçom ou o caixa:

- **Cobra o saldo inteiro** ou só uma parte. A parte pode vir de **dividir por pessoas**, em partes
  iguais, ou **por itens**: os itens que a pessoa consumiu, com a parte proporcional do imposto.
- **Escolhe a forma de pagamento:** dinheiro, cartão ou carteira digital.
- **Registra a gorjeta:** sem gorjeta, 15%, 18%, 20% ou outro valor.
- **No dinheiro, informa quanto recebeu** e o sistema calcula o troco.
- **Estorna um pagamento** registrado por engano, enquanto a comanda está aberta. Isso é do gerente
  e exige motivo.
- **Move uma rodada inteira** para outra comanda da mesma mesa, enquanto nenhuma das duas tem
  pagamento.

Quando o saldo zera, **a comanda fecha**. Quando a última comanda da mesa fecha, **a mesa vai para
limpeza**. Comandas vazias que sobraram são anuladas.

**Importante:** o Dinequora **registra** o pagamento recebido. Ele ainda **não cobra cartão**; isso
vem com o processador de pagamento, na Fase 2 do plano.

## Distribuição e conferência

O documento mestre proíbe tirar a trava de um pagamento por pedido (`payments.order_id` único) sem um
desenho de distribuição e conferência. Este é o desenho, e **a trava continua**.

| Onde | O quê |
|---|---|
| `dining_check_payments` | os **pagamentos recebidos** de uma comanda: forma, valor que abate do saldo, gorjeta, dinheiro recebido e troco, quem registrou e quando. Nunca são editados; um engano é estornado |
| `payments` (já existia) | no fechamento, **uma linha por rodada**: a parte daquele pedido no total recebido, com valor igual ao total do pedido e forma igual à dos pagamentos, ou `mixed` quando a comanda teve mais de uma forma. É a única mudança na tabela: `mixed` passa a ser aceito |
| `finance_entries` | no fechamento, **receita** (total menos imposto) e **CMV** (custo gravado nas movimentações de estoque quando a rodada foi para a cozinha), com as mesmas chaves do POS (`sale:<pedido>`). A chave única do razão impede lançar duas vezes |

**Conferência:**

- A soma dos pagamentos não estornados de uma comanda fechada é igual à soma das linhas de
  `payments` dos pedidos dela, que é o total da comanda.
- A gorjeta fica só nos pagamentos. **Não é receita**, porque é dos funcionários; vai para um
  relatório próprio mais tarde.
- Relatórios e métricas passam a contar as rodadas como vendas pagas, exatamente como uma venda do
  POS (`isRecordedSale` lê `payments`).

## Regras

- **Cobrar exige `tables.serve` e `pos.sell`.** Estornar um pagamento exige `orders.refund`.
- **Limites do valor:** de 1 centavo até o saldo (`payment_exceeds_balance`). Comanda sem itens não
  é cobrada (`check_empty`).
- **Dinheiro recebido** só existe no pagamento em dinheiro e precisa cobrir valor mais gorjeta
  (`invalid_tendered`).
- **Rodada de comanda com pagamento, ou de comanda fechada,** não pode mais ser cancelada
  (`check_has_payments`). Estorno de comanda já paga vem com o processador real.
- **Cancelamento mudou só para rodadas:** `cancel_order_with_reversal` aplica a regra acima e trava a
  comanda antes do pedido, na mesma ordem do pagamento, para não haver deadlock. Para vendas do POS
  nada mudou.

## Concorrência e idempotência

- Todas as ações da comanda travam a comanda (`FOR UPDATE`): pagamento, rodada, cancelamento,
  movimentação e fechamento acontecem um de cada vez.
- **Dois pagamentos do saldo ao mesmo tempo:** o segundo espera e é recusado
  (`payment_exceeds_balance` ou `check_not_open`). A receita entra uma vez só.
- **Pagamento e cancelamento ao mesmo tempo:** se o pagamento vem primeiro, o cancelamento é recusado;
  se o cancelamento vem primeiro, o pagamento do valor antigo é recusado.
- **Chave do cliente:** cada pagamento leva uma chave. Repetir o envio (resposta perdida) devolve o
  mesmo pagamento; uma chave reutilizada com outro valor é recusada.

## Testes

- **`scripts/security/dining_payments_integrity.mjs`** (passo 5n da suíte, nos dois modelos), com 43
  verificações:
  - pagamento parcial e final;
  - troco e gorjeta fora da receita;
  - repetição do envio;
  - recusas sem efeito nenhum;
  - distribuição `mixed` e de forma única;
  - receita e CMV lançados uma vez;
  - comandas separadas fechando uma a uma, com a mesa fechando na última;
  - estorno;
  - mover rodada;
  - venda do POS ainda cancelável;
  - concorrência.
- **`src/test/tables-page.test.tsx`:**
  - pagamento com troco e gorjeta;
  - divisão por pessoas;
  - chave reaproveitada após falha;
  - valor acima do saldo;
  - permissão de venda.

## Rollback (uma migration NOVA)

1. Restaurar `cancel_order_with_reversal` da 0018.
2. Remover `pay_dining_check`, `void_check_payment`, `move_check_round` e as funções internas.
3. Remover `dining_check_payments`.
4. Voltar o check de `payments.method` sem `mixed`, só se nenhuma linha usar esse valor.
