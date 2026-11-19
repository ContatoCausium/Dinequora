# Integridade das concessões de permissão (migration 0033, parte A)

Correção do achado **M1** da revisão de segurança da integração M2 (2026-11-19). Aditiva: nada passa
a ter mais acesso; só caminhos de concessão indevida foram fechados.

## O problema

- `set_member_access` validava as permissões individuais (`extra_permissions`) só contra o
  catálogo. A checagem `permission_exceeds_own` de um manager comparava os conjuntos **efetivos**.
- Uma permissão fora do teto do papel do membro era então **gravada inerte**. Exemplo: um manager
  **sem** `orders.resolve_pending` a gravava nas extras de um staff; o teto de staff a ignorava, e a
  checagem passava.
- Quando um owner promovia esse staff a manager (`set_member_role`), a permissão passava a valer,
  **sem concessão explícita**. A auditoria registrava só `member.role_changed`.
- O mesmo valia para qualquer permissão de manager plantada em staff (`suppliers.edit`, por
  exemplo) e para um rebaixamento seguido de nova promoção.
- `create_invitation` deixava um manager convidar staff com um perfil (por exemplo, o de sistema
  `finance`) com permissões que **ele mesmo não tem**.

## A correção (no banco, onde as RPCs são chamadas)

A tela de equipe chama as RPCs **direto do navegador** (`src/lib/org-service.ts`), sem server
function no meio. A proteção está, portanto, nas próprias RPCs e vale também contra chamadas diretas
à API.

| Onde | Regra |
|---|---|
| `set_member_access` | Uma concessão individual precisa caber no teto do papel do membro, para **qualquer** autor, owner inclusive: `permission_outside_role`. Um staff nunca guarda `orders.resolve_pending`, nem inerte |
| `set_member_access` | Um manager concede só o que ele mesmo tem, verificado **no pedido** (não só no resultado efetivo): `permission_exceeds_own` |
| `create_invitation` | Um manager convida (staff) só com permissões que ele tem, seja o perfil, sejam os padrões do papel: `permission_exceeds_own` |
| Gatilho `member_ceiling_extras` (BEFORE INSERT/UPDATE OF `role`, `extra_permissions`) | Em qualquer outro caminho (`set_member_role`, transferência de propriedade, `service_role`), as extras fora do teto do novo papel são **removidas e auditadas** (`member.extras_pruned`). Um rebaixamento não deixa nada que uma promoção posterior reative |
| Dados existentes | A 0033 remove as extras inertes já gravadas, auditando com ator nulo. As permissões efetivas **não mudam**, porque o teto já as filtrava |

Regras preservadas:

- o owner tem tudo;
- só owners gerenciam managers e criam ou editam perfis;
- managers gerenciam só o staff das suas lojas;
- admins da plataforma não são membros e não têm permissão.

Na prática, só o owner concede `orders.resolve_pending`: a um manager, já que staff não pode tê-la.

A interface já descartava permissões fora do teto (`computeAdjustments`); ela só ganhou a tradução
do novo erro e da nova ação de auditoria.

## Testes

- `scripts/security/member_grant_integrity.mjs` (passo 5h da suíte, 42 verificações):
  - concessões legítimas;
  - recusas: fora do teto, além das próprias permissões (extras, perfil e convite), manager sobre
    manager, sobre si mesmo ou fora das lojas, staff, outro tenant e admin da plataforma;
  - escrita direta pela API;
  - rebaixamento e nova promoção;
  - escrita direta pelo `service_role`.
- Rodado contra um banco **sem** a 0033, o mesmo script **falha** nos casos do M1 (controle negativo
  registrado no relatório da integração).
- `src/test/member-grant-integrity-migration.test.ts`: cada função redefinida difere da 0018 **só**
  pelas linhas marcadas como 0033.

## Rollback

A parte A da 0033 **não é desfeita** pelo rollback da M2
([m2-rollback/README.md](m2-rollback/README.md)): é uma correção de segurança independente. Se for
preciso desfazê-la, uma migration nova:

1. recria `set_member_access` e `create_invitation` com os corpos da 0018;
2. remove o gatilho `member_ceiling_extras` e a função `trg_member_extras_within_role`.

Isso reabre o M1.
