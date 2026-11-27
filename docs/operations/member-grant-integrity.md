# Integridade das concessões de permissão (migration 0033, parte A)

Corrige o achado **M1** da revisão de segurança da integração M2 e os caminhos da mesma classe que a
revisão independente encontrou (2026-11-19). Aditiva: **nenhum membro ganha acesso**. Os caminhos de
concessão indevida foram fechados, e os dados existentes foram corrigidos sem mudar as permissões
efetivas de ninguém.

## Os problemas

| Caminho | O que acontecia |
|---|---|
| `set_member_access` | As concessões individuais (`extra_permissions`) eram validadas só contra o catálogo, e a checagem `permission_exceeds_own` de um manager comparava conjuntos **efetivos**. Uma permissão fora do teto do papel era **gravada inerte** (um manager **sem** `orders.resolve_pending` a gravava num staff) e passava a valer quando um owner promovia o membro |
| `set_member_role` | Mantinha o perfil do membro. Rebaixar um administrador da organização para staff deixava o perfil de manager no lugar: o staff ficava com as permissões de admin dentro do teto de staff (financeiro, despesas, custos...), e uma nova promoção reativava tudo |
| `create_invitation` | Um manager convidava staff com um perfil (por exemplo, o de sistema `finance`) com permissões que ele mesmo não tem |
| Revogações | A revogação de uma permissão que saiu do catálogo (por exemplo, durante um rollback da M2) se perdia na primeira edição do membro, e uma reaplicação a devolvia |

## A correção (no banco, onde as RPCs são chamadas)

A tela de equipe chama as RPCs **direto do navegador** (`src/lib/org-service.ts`), sem server
function no meio. A proteção está, portanto, nas próprias RPCs e num gatilho, e vale também contra
chamadas diretas à API e escritas pelo `service_role`.

| Onde | Regra |
|---|---|
| `set_member_access` | Uma concessão individual precisa caber no teto do papel do membro, para **qualquer** autor, owner inclusive: `permission_outside_role`. Um staff nunca guarda `orders.resolve_pending`, nem inerte |
| `set_member_access` | Um manager concede só o que tem, verificado **no pedido**, tanto nas concessões individuais quanto no perfil atribuído: `permission_exceeds_own` |
| `set_member_access` | Revogações de permissões que não estão mais no catálogo são **mantidas**: só restringem. Elementos NULL, antes aceitos sem efeito, são recusados (`invalid_permission`) e os já gravados foram removidos |
| `create_invitation` | Um manager convida (staff) só com permissões que ele tem, seja o perfil, sejam os padrões do papel: `permission_exceeds_own` |
| `save_permission_profile` | O nível de um perfil usado por convite pendente não muda: `profile_tier_in_use` |
| Gatilho `member_ceiling_grants` (BEFORE INSERT/UPDATE OF `role`, `profile_id`, `extra_permissions`) | Vale em todos os caminhos: `set_member_role`, transferência de propriedade, aceite de convite, `service_role`. Regras: (1) um staff nunca fica com perfil de nível manager (`profile_tier_mismatch`): para rebaixar, o owner escolhe o novo perfil explicitamente com `set_member_access`; (2) quem vira owner perde perfil e concessões, que voltariam num rebaixamento; (3) concessões fora do teto do papel são removidas. Todas auditadas (`member.extras_pruned`) |
| Dados existentes | Corrigidos **sem mudar as permissões efetivas de ninguém**, verificado linha a linha: a migration aborta se algo mudaria. Concessões inertes são removidas; um staff com perfil de manager passa a ter as mesmas permissões como concessões e revogações explícitas, sem perfil; o perfil e as concessões que sobraram num owner são limpos. Tudo auditado com ator nulo |

O gatilho é criado com `CREATE OR REPLACE TRIGGER`, que pega SHARE ROW EXCLUSIVE e não bloqueia as
leituras de `organization_members`, usadas em toda checagem de RLS. Um `DROP TRIGGER` pegaria
ACCESS EXCLUSIVE até o fim da execução.

### Regras preservadas

- O owner tem tudo.
- Só owners gerenciam managers e criam ou editam perfis.
- Managers, inclusive o administrador da organização, gerenciam só o staff das suas lojas.
- Admins da plataforma não são membros e não têm permissão.

Na prática, só o owner concede `orders.resolve_pending`, sempre a um manager.

A interface já descartava permissões fora do teto (`computeAdjustments`) e não usa `set_member_role`.
Ela só ganhou a tradução do novo erro e da nova ação de auditoria.

## Testes

- `scripts/security/member_grant_integrity.mjs` (passo 5h da suíte, 49 verificações), com chamadas
  diretas às RPCs como cada papel:
  - concessões legítimas;
  - recusas: fora do teto, além das próprias permissões (extras, perfil e convite), manager sobre
    manager, sobre si mesmo ou fora das lojas, staff, outro tenant e admin da plataforma;
  - escrita direta pela API;
  - rebaixamento e nova promoção, promoção a owner e volta;
  - convite com perfil de nível alterado;
  - revogações fora do catálogo;
  - escrita direta pelo `service_role`.
- Controle negativo: rodado contra um banco **sem** a 0033, o mesmo script falha nos casos do M1.
- `src/test/member-grant-integrity-migration.test.ts`: cada função redefinida difere da 0018 **só**
  pelas linhas marcadas como 0033.

## Rollback

A parte A da 0033 **não é desfeita** pelo rollback da M2
([m2-rollback/README.md](m2-rollback/README.md)): é uma correção de segurança independente. Se for
preciso desfazê-la, uma migration nova:

1. recria `set_member_access`, `create_invitation` e `save_permission_profile` com os corpos da 0018;
2. remove o gatilho `member_ceiling_grants` e a função `trg_member_grant_integrity`.

Isso reabre o M1. A correção dos dados não precisa ser desfeita, porque não mudou nenhuma permissão
efetiva.
