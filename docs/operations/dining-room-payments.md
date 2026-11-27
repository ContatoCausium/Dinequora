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

## Histórico da comanda (sem migration)

Botão **Histórico** na comanda aberta e lista **Comandas fechadas** no painel "Hoje" (comandas fechadas
no dia local da loja, mais recentes primeiro, até 200). A linha do tempo é montada em
`src/lib/check-history.ts` só com o que o salão já pode ler pelas políticas de RLS existentes:

| Evento | Fonte | Quem |
|---|---|---|
| Comanda aberta | `dining_checks.opened_at/opened_by` | quem abriu |
| Rodada enviada | `dining_check_rounds.fired_at/fired_by` + `orders.total_cents` | quem enviou |
| Rodada cancelada | `order_status_history` (`to_status = 'cancelled'`) | quem cancelou |
| Pagamento e estorno | `dining_check_payments` (`created_*`, `reversed_*`) | quem registrou / estornou |
| Rodada movida | `audit_logs` (`tables.round_moved`, metadata `from`/`to`) | só aparece para quem tem `team.activity` na loja; os demais não recebem linhas (RLS) |
| Comanda fechada / anulada | `dining_checks.closed_at` + `status` | sem autor |

**Motivos de cancelamento** não são lidos nem mostrados aqui. O **motivo de um estorno** aparece só para
quem tem `orders.refund` na loja (a mesma permissão que estorna), via `list_check_reversal_reasons`
(migration 0041); para os demais o banco recusa e a linha aparece sem motivo. Nenhuma função nova
no banco, nenhum privilégio novo: as funções de servidor `fetchCheckHistory` e `fetchClosedChecksToday`
usam o cliente do usuário (RLS) e o escopo `diningScope`/`scope` de sempre.

Testes: `src/test/check-history.test.ts` (ordem, desempates, cancelamento duplicado ou de outro pedido
ignorado, movimentos, comanda anulada, lista do dia) e `src/test/tables-page.test.tsx` ("check history").

## Privacidade do motivo do estorno (migration 0041)

Antes, `dining_check_payments` dava SELECT em todas as colunas para `authenticated`, e qualquer membro
com permissão de mesas na loja lia `reversal_reason` pela API. A 0041:

- concede SELECT por coluna, **sem** `reversal_reason` (as linhas e a política de RLS não mudam; o app
  nunca selecionou essa coluna; `select *` passa a ser recusado);
- cria `list_check_reversal_reasons(org, loja, comanda)`: devolve os motivos dos estornos daquela comanda
  a quem tem `orders.refund` na loja; outra organização, loja de outra organização, staff sem a
  permissão e anon são recusados. Só leitura, sem auditoria.

Teste: passo 5p da suíte de segurança (`scripts/security/check_reversal_reason_privacy.mjs`, 13 checagens).

Rollback (uma migration NOVA): `grant select on table public.dining_check_payments to authenticated;`
e `drop function public.list_check_reversal_reasons(uuid, uuid, uuid);`.
