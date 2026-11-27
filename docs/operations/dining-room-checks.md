# Salão, etapa 2: mesa aberta, comandas e rodadas para a cozinha (migration 0038)

## O que é

Segunda etapa de "Mesas e comandas". Na tela **Mesas**, o garçom:

1. **Senta convidados** numa mesa disponível ou reservada, informando quantas pessoas. Ele fica
   registrado como garçom responsável e a mesa passa a "ocupada".
2. **Lança itens** por rodadas, com cardápio, opções e observações, e **envia cada rodada para a
   cozinha** (KDS).
3. Se as pessoas vão pagar separado, abre **outra comanda na mesma mesa**, com nome opcional como
   "Ana". Cada rodada vai para uma comanda só, e cada comanda tem o seu total.
4. Pode **mudar o grupo de mesa**, **alterar o número de pessoas** e **cancelar uma rodada** enviada
   por engano.
5. Pode **fechar sem cobrança**, quando o grupo foi embora sem pedir ou todas as rodadas foram
   canceladas.

**Fora desta etapa:** pagar e fechar uma comanda com itens, dividir a conta por item ou por valor,
pagamentos parciais e gorjeta. Tudo isso é a etapa 3. A tela mostra os totais e avisa que nada é
cobrado aqui.

## Decisão de negócio

Decidido em 27/11/2026: **o estoque baixa quando a rodada vai para a cozinha**, porque é aí que os
ingredientes são usados. A **receita só entra quando a comanda fecha**, na etapa 3.

## Modelo

As entidades seguem o documento mestre:

| Tabela | O que guarda |
|---|---|
| `dining_sessions` | a estadia de um grupo numa mesa: pessoas, garçom, abertura e fechamento. No máximo uma aberta por mesa (índice único parcial) |
| `dining_checks` | as comandas da sessão, numeradas (1, 2, 3…) e com nome opcional. A comanda 1 nasce com a sessão |
| `dining_check_rounds` | cada envio para a cozinha: exatamente um pedido (`orders.id`, único) |

**Uma rodada É um pedido.** `fire_check_round` cria o pedido por `create_pos_sale_v2`, o mesmo
caminho do POS:

- **Preço:** calculado no servidor, a partir do cardápio e dos modificadores.
- **Imposto:** a alíquota da loja; a que a tela mostrou serve só de confirmação.
- **Idempotência:** chave do cliente, protegida por advisory lock.
- **Status:** o pedido nasce "new", então o KDS, o histórico de pedidos e o ticket funcionam sem
  mudança.

Em seguida, a mesma função consome os ingredientes da receita, com as mesmas regras da venda do POS:
se faltar estoque, a rodada inteira é recusada e nada é gravado. Ela **não grava pagamento nem
receita**. Relatórios e métricas já contam só pedidos pagos (`isRecordedSale`).

Quando a mesa tem mais de uma comanda, o ticket leva o nome da comanda no campo de mesa, que é o que
o KDS mostra: "T2 · Ana", "T2 · Check 3". A comanda 1 continua "T2".

**Cancelar uma rodada** usa o cancelamento que já existe (`cancel_order_with_reversal`, permissão
`orders.refund`): o pedido sai da cozinha e os ingredientes voltam ao estoque.

## Permissão

`tables.serve` (nova, atrás de `table_service` como o resto do módulo) permite:

- sentar convidados e alterar pessoas;
- abrir outra comanda;
- enviar rodadas;
- mudar o grupo de mesa;
- fechar sem cobrança.

**Enviar rodada exige também `pos.sell`**, porque lançar itens com preço é vender.

| Quem | Tem `tables.serve` por padrão |
|---|---|
| Proprietário | sim |
| Gerente sem perfil | sim |
| Perfis de sistema `org_admin`, `manager` e `cashier` | sim |
| Equipe sem perfil | não (só por concessão) |

## Regras

- **Mesa com sessão aberta:** continua "ocupada". Não é possível mudar o status à mão
  (`table_has_open_check`) nem arquivar a mesa.
- **Sentar:** só numa mesa disponível ou reservada (`table_not_available`).
- **Mudar de mesa:** só para uma mesa livre. A mesa antiga vai para limpeza.
- **Fechar sem cobrança:** só sem rodada viva em nenhuma comanda (`check_has_items`). A mesa vai para
  limpeza e as comandas ficam anuladas (`void`).
- **Comanda fechada:** não recebe rodada (`check_not_open`).

## Concorrência e idempotência

Tudo em READ COMMITTED, o padrão da API:

- **Abrir mesa e enviar rodada:** recebem uma chave do cliente. A repetição de um pedido (resposta
  perdida, toque duplo) devolve a mesma sessão ou o mesmo pedido e não consome estoque duas vezes. A
  tela guarda a chave da rodada até ela ser gravada.
- **Abrir mesa** trava a mesa: dois grupos para a mesma mesa nunca entram os dois.
- **Rodada** trava a comanda. Rodada e fechamento ficam serializados nas duas ordens, e nunca sobra
  rodada viva numa sessão fechada.
- **Abrir comanda** trava a sessão: dois pedidos simultâneos recebem números diferentes.
- **Mudar de mesa** trava as duas mesas em ordem de id, para não haver deadlock.

## Testes

- **`scripts/security/dining_checks_integrity.mjs`** (passo 5m da suíte, nos dois modelos), com 64
  verificações:
  - abrir mesa e repetir o pedido;
  - uma única sessão por mesa;
  - mesa travada em "ocupada";
  - rodadas com preço do servidor e imposto da loja;
  - estoque baixando já no envio, sem pagamento e sem receita;
  - `pos.sell` obrigatória;
  - recusas sem efeito nenhum;
  - cancelamento devolvendo o estoque;
  - mudar de mesa e fechar sem cobrança;
  - várias comandas na mesma mesa (numeração, nome, idempotência, ticket e total por comanda);
  - concorrência com COMMIT e ROLLBACK.
- **`src/test/tables-page.test.tsx`:**
  - sentar convidados;
  - comandas separadas;
  - envio para a comanda certa;
  - a mesma chave reaproveitada após falha;
  - permissão de venda.

## Rollback (uma migration NOVA)

1. Remover as RPCs da 0038 e as três tabelas. Os pedidos das rodadas ficam, porque são pedidos
   comuns.
2. Restaurar `set_dining_table_status` e `permission_catalog()` da 0037.
3. Tirar `tables.serve` dos perfis de sistema e de `feature_permissions`.
4. Recalcular `effective_permissions`.
