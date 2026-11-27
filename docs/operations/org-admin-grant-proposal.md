# Admin da organização concedendo `orders.resolve_pending` (achado F2, PROPOSTA, não implementada)

Aguarda decisão do responsável. Muda uma regra de arquitetura do AGENTS.md ("Managers manage only
staff inside their stores"). Nada aqui foi implementado.

## Regra aprovada × hoje

| Regra aprovada | Hoje (0033) |
|---|---|
| Owner concede | Sim |
| Admin da organização concede | **Não.** Ele é um manager com o perfil `org_admin` e só gerencia staff (`can_manage_member`), só convida staff (`create_invitation`), e staff nunca pode ter a permissão (`role_ceiling`) |
| Manager só dentro das próprias autorizações | Manager não concede a ninguém (pelo mesmo motivo); `permission_exceeds_own` já limitaria ao que ele tem |
| Staff nunca | Cumprida: teto, gatilho `member_ceiling_grants`, RPCs |

Além disso, "Admin da organização" não existe como conceito no banco. É só o perfil de sistema
`org_admin`, ou uma cópia personalizada, e nada o distingue de um manager com as mesmas permissões.
E ele continua restrito às lojas atribuídas: só o Owner vale para a organização inteira.

## Solução técnica recomendada

A autoridade vem de uma **permissão**, nunca do nome de um perfil.

1. **Permissão nova `team.manage_managers`:**
   - entra no catálogo e no teto do nível manager;
   - fica fora do padrão de manager;
   - entra no perfil de sistema `org_admin`;
   - **só o Owner** pode concedê-la, por perfil ou extra. Um manager que a tenha não a repassa, o que
     evita propagação em cadeia.
2. **`can_manage_member(alvo)`:** além do caso atual (manager → staff das suas lojas), um manager com
   `team.manage_managers` gerencia um **manager** quando:
   - o alvo não é Owner nem ele mesmo;
   - **todas** as lojas do alvo estão no escopo dele;
   - as permissões efetivas **atuais** do alvo são subconjunto das dele. Assim ele não mexe em quem
     tem mais poder, nem para retirar, o que evita um ataque de negação a um par.
3. **`set_member_access`:**
   - mudança de nível (staff ↔ manager) continua só com o Owner;
   - as regras da 0033 valem como estão: extras, perfil e permissões finais do alvo continuam ⊆ as
     de quem concede (`permission_exceeds_own`) e dentro do teto (`permission_outside_role`);
   - conceder ou retirar `team.manage_managers` exige Owner.
4. **`create_invitation`:** um manager com `team.manage_managers` pode convidar `manager`, com
   permissões efetivas ⊆ as dele e lojas ⊆ o escopo dele. Hoje o aceite não reconfere o convidante,
   então o aceite deve passar a reconferir: o convidante ainda tem as permissões e o papel.
5. **`remove_member`:** a mesma condição do item 2 para remover um manager.
6. **`orders.resolve_pending`:** com isso, o Admin concede a um manager das suas lojas se ele mesmo a
   tiver (o perfil `org_admin` já a tem). Staff continua impedido pelo teto.
7. **App:**
   - a tela de Equipe mostra a edição de managers só para quem tem a permissão;
   - a matriz de permissões e as traduções acompanham;
   - os erros novos ganham mensagens.
8. **Documentação:** AGENTS.md (a regra de gerenciamento muda), `docs/authorization-patterns.md` e
   `member-grant-integrity.md`.
9. **Migration nova**, aditiva, com rollback gerado:
   - o rollback tira a permissão de todos os perfis e concessões, auditado como no rollback da M2;
   - volta os corpos da 0033.

## Alternativas

| | Prós | Contras |
|---|---|---|
| **(Recomendada)** permissão `team.manage_managers` | Explícita, auditável, concedida só pelo Owner, testável | Muda uma regra de arquitetura; mais superfície |
| Reconhecer o perfil `org_admin` pelo nome (`key`) | Pequena | Autoridade por nome de perfil é frágil: cópias personalizadas, renomeações |
| Manter como está (só o Owner concede) | Nenhuma mudança; o mais restritivo | Não cumpre a regra aprovada para o Admin |

## Testes necessários

1. Owner concede a um manager: sim.
2. Admin com a permissão concede a um manager das suas lojas: sim, auditado.
3. Admin concede a um manager com lojas fora do escopo dele: `forbidden`.
4. Admin concede a um manager com permissões que ele não tem: `forbidden`.
5. Admin sem a permissão: `permission_exceeds_own`.
6. Admin tenta conceder ou retirar `team.manage_managers`: recusado.
7. Admin altera o próprio acesso: `forbidden`.
8. Admin muda o nível de alguém: `forbidden`.
9. Manager comum edita um manager: `forbidden`.
10. Staff com perfil ou extra: recusado pelo teto.
11. Convite de manager pelo Admin: permissões ⊆ as dele.
12. Aceite depois que o convidante perdeu a permissão: recusado.
13. Escalada indireta:
    - perfil editado depois;
    - cadeia A→B→C;
    - promoção e rebaixamento;
    - convite antigo.
14. Outro tenant e admin da plataforma: nada.
15. Duas sessões concorrentes editando o mesmo manager: o lock da linha serializa, e o resultado
    respeita as duas regras.
16. A suíte de concessões (50 casos) estendida, a matriz completa, e o rollback e a reaplicação
    ensaiados.
