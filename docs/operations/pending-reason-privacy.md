# Privacidade das justificativas de venda pendente (migration 0035)

Ao encerrar uma venda pendente (`resolve_pending_pos_sale`, 0032/0033), quem resolve escreve uma
justificativa livre (10 a 500 caracteres). Esse texto pode conter dados pessoais ("cliente João saiu
sem pagar", um telefone).

## O problema (achados F3 e F4)

Até a 0033 o texto ficava em duas cópias, legíveis por gente demais:

| Onde | Quem lia |
|---|---|
| `pos_sale_key_voids.reason` | Quem tem `pos.sell`, `orders.view` ou `orders.resolve_pending` na loja, ou seja, caixas incluídos |
| `audit_logs.metadata.reason` | Quem tem `team.activity` em **toda** a organização, sem recorte de loja, e admins da plataforma em **todos** os tenants |

## A regra agora (no banco e nas RPCs)

| Quem | Lê o texto |
|---|---|
| Owner | Sim, em todas as lojas |
| Admin da organização (manager com o perfil `org_admin`) | Sim, nas lojas a que tem acesso |
| Manager com `orders.resolve_pending` concedida | Sim, só nas lojas a que tem acesso |
| Manager sem a permissão, inclusive com `team.activity` | Não |
| Staff (caixa, cozinha…) | Nunca: o nível não pode ter a permissão, e o leitor recusa o nível staff |
| Admin da plataforma | Não: não é membro. Vê só a auditoria estruturada |
| Outro tenant, outra loja, `anon` | Não |

Como funciona:

1. **Armazenamento único e privado:** `pos_pending_resolution_reasons`.
   - Tem RLS ligada, nenhuma policy e nenhum privilégio para `anon` ou `authenticated`; só
     `service_role`.
   - Cada resolução grava uma linha, com organização, loja, chave, resultado (`resolved` ou
     `recovered`), pedido, ator, texto e horário.
   - A coluna `redacted_at` fica reservada para a retenção
     ([pending-reason-retention.md](pending-reason-retention.md)).
2. **Chave encerrada sem texto:**
   - `pos_sale_key_voids.reason` recebe o marcador fixo `[moved to pos_pending_resolution_reasons]`. A
     tabela não é alterada (sem `ALTER TABLE`, que travaria em ACCESS EXCLUSIVE a tabela que toda venda lê).
   - A API lê só `org_id`, `client_order_id`, `location_id` e `created_at`, que é o que a busca do
     PDV usa, inclusive no Worker publicado (55493d4).
   - `select *` e `select reason` são recusados para todos.
3. **Auditoria sem texto:**
   - `pos.pending_sale_resolved` e `pos.pending_sale_recovered` mantêm os campos estruturados (ator,
     loja, chave, horário, valor, tentativas, pedido, pago).
   - No lugar do texto entram `reason_id` (o vínculo) e `reason_length`.
4. **Leitura só pela RPC `list_pending_sale_reasons(org, loja, chave?, limite?)`:**
   - `SECURITY DEFINER`, com `search_path` fixo;
   - exige membro de nível owner ou manager;
   - exige uma loja da organização;
   - exige `orders.resolve_pending` **naquela loja**.
5. **Log de atividades recortado por loja:**
   - um evento gravado para uma loja só aparece para quem tem acesso a ela (Owners: todas);
   - eventos da organização, sem loja, continuam visíveis como antes para quem tem
     `team.activity`;
   - a lista de lojas é calculada uma vez por consulta (`audit_visible_location_ids()`, desta
     migration; o rollback da M2 não a remove), não uma chamada por linha;
   - a tela de atividade já não mostrava o metadata, então nada muda nela além do recorte.
6. **Textos já gravados são movidos, nunca descartados:**
   - cada evento de auditoria e cada chave encerrada ganha sua linha no armazenamento privado, e os
     textos são retirados da auditoria e da chave;
   - a migration confere que nada sobrou (senão aborta tudo) e audita o movimento por organização
     (`pos.pending_reasons_moved`);
   - registros de auditoria de organizações apagadas (`org_id` nulo) ficam como estão;
   - os bancos hospedados nunca rodaram a 0032, então lá não há o que mover.

## Ordem e locks

- A função e a policy são trocadas **antes** do movimento; o movimento roda por último, já com o lock da
  policy de `audit_logs`. Nenhuma outra transação grava auditoria entre o movimento e o commit.
- `ALTER POLICY` em `audit_logs` toma ACCESS EXCLUSIVE por um instante (limite de espera de 5 s, como a
  `finance_read` da 0031). Durante a espera as gravações de auditoria ficam na fila.
- Num banco que **já estava em 0033** (só local e de teste), uma resolução que começou antes do commit com
  a função antiga ainda pode gravar texto depois. A verificação pós-publicação do checklist cobre isso;
  havendo sobra, a 0035 pode ser reaplicada (idempotente). No hospedado (0030 → 0035 numa transação)
  não existe função antiga em execução.

## Riscos aceitos

- **Auditoria de organizações apagadas** (`org_id` nulo) com texto anterior à 0035 fica como está: não há
  organização sob a qual guardar o texto, e admins da plataforma ainda a leem. Só existe em bancos
  locais e de teste, ou numa janela de rollback da 0035.
- **`pos.pending_reasons_moved`** é da organização (sem loja): quem tem `team.activity` vê as contagens,
  que podem incluir eventos de outras lojas. São números, sem texto.
- **`reason_length`** continua na auditoria estruturada.

## Compatibilidade

- **Worker publicado (55493d4):** lê só `created_at` das chaves encerradas e não chama a RPC.
- **App da M2:** usa `resolve_pending_pos_sale`, que tem a mesma assinatura, as mesmas verificações e
  o mesmo lock.
- **Busca do PDV (`lookupSaleByKey`):** inalterada.
- **Nenhuma tela mostra a justificativa hoje.** A RPC é o caminho para uma tela futura, que deve
  seguir as mesmas regras.

## Testes

- `scripts/security/pending_reason_privacy.mjs` (passo 5j; 49 verificações). Sessões reais de cada
  papel cobrem:
  - armazenamento;
  - leitura direta, que é recusada;
  - escrita, que é recusada;
  - a RPC por papel e por loja;
  - o recorte do log;
  - os privilégios.
- `src/test/integration/pos-pending-resolution.db.test.ts`: as mesmas regras por chamadas reais ao
  PostgREST, com cada usuário logado. Faz parte do passo 7.
- `scripts/security/security_closure_rollback.mjs` (passo 9): rollback, textos gravados à moda da
  0033 nessa janela, reaplicação que os move exatamente, e idempotência.
- Movimento ensaiado também num banco em 0033 com dados reais (upgrade pelo runner), conferido campo a
  campo.
- Controle negativo: o script de privacidade contra a 0033 falha.

## Rollback

`docs/operations/security-closure/0035-rollback.sql`, gerado, que vira uma migration nova revisada.
- **Restaura:** a função da 0033, a policy da auditoria da 0019, e remove o leitor.
- **Não devolve** texto algum à chave ou à auditoria.
- **Não reabre** a leitura da coluna.

Reaplicação: rodar a 0035 de novo (idempotente; move o que tiver sido gravado à moda da 0033
durante a janela).
