# Rollback e reaplicação da M2 (0031 e 0032)

Arquivos **gerados** das próprias migrations por `scripts/qa/build-m2-rollback.mjs`. Não edite à mão.
O teste `src/test/m2-rollback-files.test.ts` falha se eles divergirem das migrations.

| Arquivo | O que faz |
|---|---|
| `rollback.sql` | Desfaz a 0032 e a 0031, nessa ordem; a 0033 fica. Remove também o leitor de justificativas da 0035 (`list_pending_sale_reasons`), mantendo o armazenamento privado e seus textos |
| `reapply.sql` | Reaplica 0031, 0032 (com o catálogo de permissões como está na ponta), 0033 e **0035** depois desse rollback, de forma idempotente onde o rollback manteve objetos. A 0035 vem depois da 0033 porque a função da 0033 gravaria o texto na chave e na auditoria |

Nenhum dos dois é uma migration. Num rollback real, cada um vira o conteúdo de uma migration **nova**
e revisada (0036, 0037…), aplicada pelo runner normal, que usa uma transação única. Por isso eles não
têm `BEGIN`/`COMMIT` e começam com `set local lock_timeout = '5s';`.

## O que o rollback faz e por quê

- **Remove:**
  - `ledger_day_totals` e `accessible_location_ids`;
  - `resolve_pending_pos_sale`.
- **Restaura:**
  - catálogo de permissões **como está na ponta**, sem `orders.resolve_pending` (até a 0036 é igual
    ao da 0020; desde a 0037 inclui as permissões de mesas, que o rollback do M2 não remove), e teto
    e padrões de permissão da 0018, que derivam do catálogo;
  - a `finance_read` da 0019.
- **Nunca usa `DROP ... CASCADE`:** a política depende de `accessible_location_ids`, e o
  `CASCADE` a removeria, deixando o ledger ilegível.
- **Tira `orders.resolve_pending` de todos os perfis** (de sistema **e personalizados**) e de todas
  as concessões individuais, **com auditoria**: `permission_profile.saved` com motivo
  `m2_rollback` e `member.extras_pruned`, pelo gatilho da 0033. Assim uma reaplicação não reativa
  nada sem aviso. Esta é a correção de 2026-11-19: o rascunho anterior só limpava o `org_admin`, e o
  ensaio mostrou que um perfil personalizado continuava listando a permissão.
- **Mantém:**
  - **`create_pos_sale_v2` da 0033 e `pos_sale_key_voids`:** uma chave encerrada continua
    recusando venda **durante** a janela de rollback. O caixa que guardava a venda pendente pode
    reenviá-la a qualquer momento, e ela já foi acertada por outro meio; voltar ao corpo da 0025 a
    gravaria em duplicidade. Achado da revisão independente: o rascunho anterior voltava à 0025;
  - **as revogações explícitas (`revoked_permissions`):** revogar só restringe, e perdê-las
    devolveria a permissão a um administrador da organização numa reaplicação. Uma edição do membro
    na janela também as preserva: `set_member_access` mantém revogações de permissões fora do
    catálogo;
  - **a integridade de concessões da 0033 (parte A):** correção de segurança independente da M2
    (ver [../member-grant-integrity.md](../member-grant-integrity.md)).

## Reaplicação

- A permissão volta **só** ao perfil de sistema `org_admin` (como na 0032) e aos owners.
- Perfis personalizados e concessões individuais ficam **sem** ela até um owner concedê-la de novo.
- As revogações mantidas continuam valendo.

## Ordem com o app

| Etapa | Ordem |
|---|---|
| **Rollback** | Banco primeiro. O app atual detecta a ausência de `ledger_day_totals` e volta ao leitor paginado. O encerramento manual passa a falhar, e a venda fica pendente (seguro). Depois, se quiser, republique o Worker anterior: ele é compatível com os dois estados |
| **Reaplicação** | Banco e app juntos |

## Ensaio (stack descartável apenas)

`scripts/security/m2_rollback_reapply.mjs` (passo 8 da suíte de segurança, o último porque muda o
schema) faz o ciclo completo:

1. **Fixture:** org admin, manager com concessão individual, manager com perfil personalizado, admin
   com revogação, staff e uma chave encerrada.
2. **`rollback.sql` numa transação:**
   - nenhum membro além do owner tem a permissão;
   - os perfis personalizados foram limpos, com auditoria;
   - as revogações e as chaves foram mantidas;
   - uma venda e a leitura do ledger funcionam;
   - o reenvio de uma chave encerrada continua recusado;
   - uma edição do admin revogado, feita como a tela faria, mantém a revogação.
3. **`reapply.sql`:**
   - funções (corpo, configuração, privilégios), políticas e gatilhos **idênticos** ao estado
     depois da 0033;
   - só o owner e o org admin têm a permissão;
   - a chave encerrada antes do rollback continua recusando venda.
4. **`reapply.sql` de novo:** nada muda (idempotente).

```bash
QA_DB_URL=postgresql://...@127.0.0.1:<porta>/postgres node scripts/security/m2_rollback_reapply.mjs
```

## Retenção da justificativa (proposta, não implementada)

> **Atualizado pela 0035:** o texto saiu da chave encerrada e da auditoria e vive só em
> `pos_pending_resolution_reasons`. A proposta revisada, com a escolha do agendamento, está em
> [../pending-reason-retention.md](../pending-reason-retention.md); o texto abaixo descreve o estado da 0033.

Nada foi apagado nem anonimizado. Esta seção é uma proposta para decisão.

### Onde está o texto

- `pos_sale_key_voids.reason`.
- `metadata.reason` dos registros de auditoria `pos.pending_sale_resolved` e
  `pos.pending_sale_recovered`.
- O texto é livre, com 10 a 500 caracteres, e pode conter dados pessoais ("cliente João saiu sem
  pagar", um telefone).

### O que nunca muda

- A linha da chave encerrada: org, loja, chave, ator, valor declarado, tentativas e horários.
- O registro de auditoria e seus campos estruturados: ação, ator, loja, alvo e horário; no
  `recovered`, também `order_id`, `order_status` e `paid`.
- É isso que prova quem encerrou qual venda e quando, e é isso que mantém recusadas as requisições
  atrasadas.

### Proposta

| | |
|---|---|
| **Prazo** | Texto integral por **180 dias** a partir do encerramento |
| **Depois do prazo** | Substituir só o texto por `[redigido após 180 dias]`, na chave encerrada e no `metadata.reason` da auditoria, e acrescentar `reason_redacted_at` ao metadata. Linhas nunca são apagadas |
| **Como** | Uma função `service_role`, por organização e em lote, auditada: um registro `retention.reasons_redacted` com a contagem. Roda manualmente pelo operador ou agendada. O marcador tem mais de 10 caracteres, então não é preciso mudar o CHECK da tabela |
| **Por que 180 dias** | Cobre a janela usual de contestação de pagamento com cartão nos EUA (até ~120 dias) com folga, e o fechamento contábil semestral. Depois disso o texto livre perde utilidade e passa a ser só risco de dado pessoal: minimização de dados (CCPA/CPRA e leis estaduais) |
| **Impacto** | O texto dos encerramentos antigos deixa de ser legível no log de atividades. Quem, quando, onde, quanto e o resultado continuam íntegros. Armazenamento desprezível. A redação altera registros de auditoria: o próprio ato de redigir é auditado, e a função não pode mexer em nenhum outro campo |
| **Alternativas** | (a) manter para sempre (situação atual) e orientar a equipe a não escrever dados pessoais; (b) deixar de copiar o texto para a auditoria daqui para a frente (menos duplicação, menos rastreabilidade); (c) prazo diferente |

### Ponto relacionado (achado H2 da revisão, decisão de negócio)

> **Resolvido pela 0035** ([../pending-reason-privacy.md](../pending-reason-privacy.md)): o texto só é
> legível pelo Owner, pelo Admin da organização e por managers com `orders.resolve_pending` na loja.

Hoje, quem tem `pos.sell` ou `orders.view` na loja lê o motivo, o ator e o valor dos encerramentos.
Uma opção é restringir a leitura do **texto** a quem tem `orders.resolve_pending`.
