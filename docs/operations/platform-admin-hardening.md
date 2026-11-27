# Endurecimento das funções de administrador da plataforma (migration 0043)

Revisão das funções `admin_*` feita em 27/11/2026 (Fase 3 do plano). Todas checam `is_platform_admin()`
antes de ler ou escrever, são `SECURITY DEFINER` com `search_path` fixo e não são executáveis por anon.
Corrigido na 0043 (mesmas assinaturas e grants):

| # | Problema | Correção | Teste (passo 5s) |
|---|---|---|---|
| 1 | Operador podia virar **gerente/staff** de restaurante cliente (só "dono" era bloqueado em 0034) e então ler pedidos e financeiro | gatilho de `user_roles` recusa papel de plataforma para membro de organização cliente em qualquer papel (`platform_role_member_conflict`); gatilho adiado em `organization_members` recusa o inverso no commit; demo continua permitido | S1–S4 |
| 2 | Dois admins revogando um ao outro ao mesmo tempo podiam deixar **zero admins** | trava `pg_advisory_xact_lock` antes da contagem e nova checagem de admin depois da espera | L1, L2 |
| 3 | Auditoria registrava concessão/revogação que **não aconteceu** | audita só se uma linha mudou | A1 |
| 4 | Toda chamada em org em carência **reiniciava os 7 dias** | `grace_ends_at`/`canceled_at` só quando o status **muda** | G1–G3 |
| 5 | Possível **deadlock** entre `admin_set_subscription` e `admin_update_organization` | as duas travam organização e depois assinatura | — |
| 6 | Mudar só plano/limite de org suspensa **trocava o texto da suspensão** (visível a todos os membros) | `suspended_reason` só muda quando um status é passado | R1–R3 |

O teste X7 de `admin_assign_owner_integrity.mjs` (0034) foi atualizado: a cadeia "rebaixar o operador →
dar o papel → promover de novo" agora para já na concessão (`platform_role_member_conflict`).

## Pendente de decisão (não alterado)

- **Admins de plataforma leem a auditoria estruturada de todos os restaurantes**, inclusive valores em
  `metadata` (`total_cents` de vendas, `amount_cents`/`tip_cents` de pagamentos de comanda). A 0035 decidiu
  manter isso ("platform admins keep the structured audit"). Se o operador não deve ver valores de
  clientes, restringir a política e `admin_list_audit` às ações `platform.*`/`billing.*`/`feature.*` ou
  remover campos de dinheiro.
- **Notas do operador aparecem para o restaurante**: `_verification_note` de `admin_assign_owner` e
  `_reason` de `admin_update_organization`/`admin_set_subscription` vão para a auditoria da organização,
  que membros com `team.activity` leem. Opção: guardar notas da plataforma em auditoria com `org_id` nulo.

**Ensaio de rollback da 0034:** reaplicar o arquivo 0034 traz de volta o corpo antigo de
`admin_set_platform_role` e do gatilho de separação; numa reaplicação real, rode a 0043 de novo em seguida
(tudo nela é reexecutável). `scripts/security/security_closure_rollback.mjs` faz isso sozinho: acha pelo
journal toda migration posterior a 0036 que redefine uma função de 0034–0036 e a reexecuta.

Rollback (migration NOVA): restaurar `admin_set_platform_role` (0034), `admin_set_subscription` e
`admin_update_organization` (0004), `trg_platform_role_separation` (0034); remover o gatilho
`member_platform_separation` e a função `trg_member_platform_separation()`.
