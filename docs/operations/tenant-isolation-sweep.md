# Varredura de isolamento entre restaurantes (passo 5r)

`scripts/security/tenant_isolation_sweep.mjs` roda na suíte de segurança depois que o tenant de QA e o
segundo tenant são semeados. Ela não tem lista de tabelas: lê o catálogo e testa **toda tabela e view do
schema `public` com coluna `org_id`**, então uma tabela nova entra na verificação no dia em que é criada.

Para cada organização X com linhas na tabela, o dono de **outra** organização (que não é membro de X e não
tem papel de plataforma), conectado como `authenticated`:

- **lê 0 linhas de X** ("permission denied" também conta como isolado);
- numa transação **sempre desfeita**, **altera 0 e apaga 0** linhas de X (ou é recusado).

Uma view que não seja `security_invoker` roda como a dona e ignora o RLS: ela aparece como vazamento.
Tabelas sem linhas de nenhuma organização naquele momento são listadas como "not exercised" (informativo),
para que uma lacuna do seed fique visível em vez de passar em silêncio.

Teste de mutação feito em 27/11/2026 numa stack local descartável: uma view sem `security_invoker` sobre
`orders` foi criada por um instante; a varredura falhou nas duas organizações (leitura e aviso de view),
e a view foi removida. Resultado normal na mesma stack: 83/83.

O que ela **não** cobre (continua nos testes próprios de cada etapa): funções `SECURITY DEFINER` que leem
dados de tenant (`list_*`, relatórios), tabelas sem `org_id` (por exemplo `order_item_modifiers`,
`recipe_ingredients`) e escrita por RPC.
