# Varredura de isolamento entre restaurantes (passo 5r)

`scripts/security/tenant_isolation_sweep.mjs` roda na suíte de segurança depois que o tenant de QA e o
segundo tenant são semeados. Ela não tem lista de tabelas: lê o catálogo e testa **toda tabela e view do
schema `public` com coluna `org_id`**, então uma tabela nova entra na verificação no dia em que é criada.

Para cada organização X com linhas na tabela, o dono de **outra** organização (que não é membro de X e não
tem papel de plataforma), conectado como `authenticated`:

- **lê 0 linhas de X** ("permission denied" também conta como isolado);
- numa transação **sempre desfeita**, **altera 0 e apaga 0** linhas de X (ou é recusado).

Uma view que não seja `security_invoker` roda como a dona e ignora o RLS: ela aparece como vazamento.
Os testes de cada etapa limpam o que criam, então antes de varrer a própria varredura cria **uma linha
em cada tabela do salão e de uso do assistente** (setor, mesa, evento de status, sessão, comanda, rodada,
pagamento, uso da IA; e liga `table_service` se estava desligado) para a organização com mais pedidos,
marcadas com `SWEEP`/`sweep-`, e apaga tudo no fim (e desliga o módulo se foi ela que ligou). Na CI
de 27/11, antes disso, essas tabelas apareciam como "not exercised".

Tabelas sem linhas de nenhuma organização naquele momento são listadas como "not exercised" (informativo),
para que uma lacuna do seed fique visível em vez de passar em silêncio.

Teste de mutação feito em 27/11/2026 numa stack local descartável: uma view sem `security_invoker` sobre
`orders` foi criada por um instante; a varredura falhou nas duas organizações (leitura e aviso de view),
e a view foi removida. Resultado normal na mesma stack: 87/87 com a fixture (83/83 sem ela).

O que ela **não** cobre (continua nos testes próprios de cada etapa): funções `SECURITY DEFINER` que leem
dados de tenant (`list_*`, relatórios), tabelas sem `org_id` (por exemplo `order_item_modifiers`,
`recipe_ingredients`) e escrita por RPC.
