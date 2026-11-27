# Retenção das justificativas de venda pendente: 180 dias (PROPOSTA, não implementada)

Nada aqui foi implementado ou agendado, e nada foi apagado nem anonimizado. A implementação depende
de aprovação.

## Situação depois da 0035

O texto vive num **único lugar**: `pos_pending_resolution_reasons.reason`. Ele foi retirado da chave
encerrada e da auditoria ([pending-reason-privacy.md](pending-reason-privacy.md)). Por isso a
retenção mexe em uma tabela só e **não altera a auditoria**.

## O que é preservado para sempre

- **Chave encerrada** (`pos_sale_key_voids`): organização, chave, loja, ator, valor declarado,
  tentativas e horários. É isso que continua recusando a venda atrasada (`sale_key_voided`).
- **Auditoria** (`pos.pending_sale_resolved` / `recovered`): ação, ator, loja, chave, horário, valor,
  tentativas, pedido, situação do pedido, pago, `reason_id` e `reason_length`.
- **Linha do armazenamento privado:** organização, loja, chave, resultado, pedido, ator e horário.
  Só a coluna `reason` muda.

## Proposta

| | |
|---|---|
| **Prazo** | Texto integral por 180 dias a partir do encerramento (`created_at`) |
| **Depois** | `reason` passa a `[redacted: retention 180d]`, com 26 caracteres (cumpre o CHECK de 10 a 500), e `redacted_at` recebe a data e hora da redação. A linha nunca é apagada |
| **Função** | `redact_expired_pending_reasons(_batch int default 500)`, `SECURITY DEFINER`, executável só por `service_role`. O corte é calculado **no banco** (`now() - interval '180 days'`), nunca recebido como parâmetro. Lotes com `FOR UPDATE SKIP LOCKED`, `lock_timeout` e `statement_timeout`. Ignora linhas com retenção legal. Audita por organização: `retention.reasons_redacted` com contagem e corte |
| **Retenção legal** | Coluna `legal_hold boolean default false` (ou tabela de holds), marcada por uma RPC do Owner, auditada. Linhas em hold nunca são redigidas |
| **Idempotência** | Só redige `redacted_at is null`; rodar duas vezes não muda nada |

## Agendamento: pg_cron × cron externo

| | pg_cron (extensão no Supabase) | Cron externo (Cloudflare Cron Trigger / GitHub Actions) |
|---|---|---|
| Onde roda | Dentro do banco, como `postgres` | Fora, chamando a RPC com a chave `service_role` |
| Segredos | Nenhum fora do banco | A chave `service_role` precisa ficar no agendador (rotação, vazamento) |
| Cópias e restaurações | **Roda em qualquer cópia restaurada** do banco, inclusive num stack local ou de ensaio. Exige uma trava por ambiente | Só roda onde foi configurado |
| Observabilidade | `cron.job_run_details`; o alerta precisa ser montado à parte | Logs e alertas do agendador (falha visível, retentativa) |
| Pausar ou desligar | `cron.unschedule` (migration ou SQL do operador) | Desligar o job, sem tocar no banco |
| Mudança de infraestrutura | Habilitar a extensão (migration nova). É mudança de banco hospedado | Configuração do agendador; o banco recebe só a função |
| Falha silenciosa | Possível se ninguém olhar o histórico | Mais fácil de alertar |

**Recomendação:** cron externo diário, chamando a função com `service_role`, com alerta de falha e um
alerta independente pela **idade do texto mais antigo não redigido** (> 181 dias). Motivo principal:
uma cópia restaurada do banco não redige sozinha, e a operação fica visível e pausável fora do
banco. O pg_cron também é viável se o responsável preferir não guardar a chave `service_role` num
agendador. Nesse caso, a função deve recusar rodar fora do projeto marcado (como faz o
`client_preview_identity`).

## Impactos

- **Disputas:** cobre a janela usual de contestação com cartão (cerca de 120 dias) com folga.
  Disputas raras mais longas ficam sem o texto, mas com todos os campos estruturados. **Confirmar o
  prazo com o jurídico** (LGPD, CCPA/CPRA, prazos fiscais; o texto não é documento fiscal).
- **Backups e PITR do Supabase:** guardam o texto até o fim da retenção deles, mesmo depois da
  redação. Isso deve constar da política de privacidade.
- **Logs:** uma chamada com erro pode registrar o texto nos logs do Postgres
  (`log_min_error_statement`), com a retenção de logs do Supabase. O app não guarda o texto no
  navegador nem na observabilidade.
- **Prova do conteúdo:** depois do prazo não há como provar o que foi escrito. Guardar um hash não
  ajuda: o texto é curto e o hash seria adivinhável, a menos que se use HMAC com segredo. Aceito
  por desenho.

## Riscos

| Risco | Mitigação |
|---|---|
| Rotina parada: retenção não cumprida | Alerta pela idade do texto mais antigo |
| Rotina errada: redige texto recente | Corte calculado no banco; teste de fronteira; contagem auditada |
| Lock ou duração | Lotes pequenos, `SKIP LOCKED`, limites de tempo |
| Investigação em curso | Retenção legal |
| Cópia restaurada redigindo sozinha (pg_cron) | Cron externo, ou trava por projeto na função |

## Testes necessários (quando implementar)

1. 179 dias e 23 horas não redige; 180 dias e 1 segundo redige.
2. Idempotência: a segunda execução não muda nada.
3. Só `reason` e `redacted_at` mudam: hash da linha sem essas colunas igual antes e depois. Chave
   encerrada e auditoria intactas.
4. Retenção legal respeitada.
5. Sem `EXECUTE` para `anon` e `authenticated`; um Owner chamando é recusado.
6. A execução fica auditada por organização, com corte e contagem.
7. Chave redigida continua recusando a venda (`sale_key_voided`), e a busca do PDV continua
   `resolved`.
8. `list_pending_sale_reasons` mostra o marcador e `redacted_at`.
9. Lote grande: tempo e locks medidos; concorrência com uma resolução nova não bloqueia nem perde
   linha.
10. Rollback e reaplicação da M2 e da 0035 continuam passando.
