# Relatório de gorjetas por garçom (migration 0046)

Painel **Gorjetas por garçom** em **Financeiro › Relatórios & exportações**, para quem tem acesso às mesas
(`tables.view`). Para a loja do seletor (ou todas) e os últimos 7, 14 ou 30 dias: por garçom (o garçom da
sessão da mesa) e loja, pagamentos, **gorjetas**, **gorjetas em dinheiro** e **em cartão/carteira**, com
**CSV** para a folha de pagamento.

- Só pagamentos `recorded`: um pagamento estornado sai com a sua gorjeta.
- Gorjeta é da equipe e nunca é receita (0039); por isso aparece aqui e não no razão financeiro.
- Dinheiro e não-dinheiro ficam separados porque a folha e a declaração de gorjetas tratam cada um de
  um jeito; o painel pede para confirmar as regras com o contador.

## Banco: `tips_by_server(org, lojas, dias)` (0046)

Leitura agregada, `SECURITY INVOKER`: o RLS de quem lê decide o que conta (pagamentos, comandas e sessões
do salão). Janela: últimos N dias locais de cada loja. Nenhuma escrita, nenhuma tabela, nenhum privilégio
novo além de `EXECUTE` para `authenticated`.

Teste: passo 5v da suíte de segurança (`scripts/security/tips_by_server_integrity.mjs`, 8 checagens:
gorjetas por garçom, dinheiro à parte, estornado fora, janela de 14 e 30 dias, loja de outra organização,
isolamento entre organizações, anon, SECURITY INVOKER).

Conferido no app local em 27/11: QA Owner, 2 pagamentos, US$ 3,06 de gorjeta, toda em cartão (o
pagamento de teste estornado ficou de fora).

Rollback (migration NOVA): `drop function public.tips_by_server(uuid, uuid[], integer);`
