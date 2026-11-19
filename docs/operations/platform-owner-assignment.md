# Definição de proprietário pela plataforma (migration 0034)

`admin_assign_owner` é o único caminho pelo qual um admin da plataforma mexe em quem é Owner de uma
organização de cliente. Serve só para **recuperar uma organização sem Owner ativo**: por exemplo,
quando a conta do único Owner foi apagada.

## O problema (achado F1, P1, anterior à M2)

Até a 0033 valia o corpo da 0001. Um admin da plataforma podia:
- atribuir **qualquer** conta confirmada, inclusive a própria, como Owner de **qualquer**
  organização, também de uma que já tinha Owner;
- como segundo Owner, rebaixar ou remover os Owners originais. Só o último Owner é protegido.

O resultado era a tomada de um tenant inteiro: todas as lojas, faturamento, dados de clientes,
estornos e equipe. A tela do Control Center só mostrava o botão para organização sem Owner, mas o
banco não exigia isso.

## A regra agora (no banco)

`admin_assign_owner(_org_id, _email, _verification_note)` mantém a mesma assinatura e os mesmos
grants. Verifica, nesta ordem:

| # | Verificação | Erro |
|---|---|---|
| 1 | Quem chama tem o papel `platform_admin` (`support` não tem) | `forbidden` |
| 2 | Transação em READ COMMITTED: um nível acima leria um snapshot anterior à espera pelo lock | `isolation_unsupported` |
| 3 | Nota de verificação com pelo menos 10 caracteres | `verification_required` |
| 4 | Lock transacional por organização (`pg_advisory_xact_lock`) e linha da organização travada (`FOR NO KEY UPDATE`) | — |
| 5 | A organização existe | `not_found` |
| 6 | A organização **não tem Owner ativo**, ou seja, um Owner cuja conta existe em `auth.users` e não está apagada (`deleted_at`) | `owner_exists` |
| 7 | A conta alvo existe, está confirmada e não foi apagada; o e-mail corresponde a uma única conta | `user_not_found`, `user_ambiguous` |
| 8 | O alvo não é quem chama | `self_assignment_forbidden` |
| 9 | O alvo não tem **nenhum** papel de plataforma (`platform_admin` ou `support`), verificado sob um lock por conta | `platform_user_forbidden` |

Depois disso, a função só **insere** o novo Owner, ou **promove** quem já era membro. A 0033 limpa
o perfil e as concessões individuais desse membro, com auditoria.

A função nunca remove nem rebaixa ninguém. As linhas de Owners inativos ficam como estão.

Auditoria: `platform.owner_assigned`, com `verification`, `previous_role`, `org_status` e
`inactive_owner_rows`.

### A separação vale depois também

A regra é aplicada pelos dois lados, com o erro `platform_role_owner_conflict`:

- **Lado do papel:** o gatilho `platform_role_separation` em `user_roles` recusa qualquer papel de
  plataforma para uma conta que seja Owner de uma organização de cliente (não demo). Vale para
  `admin_set_platform_role`, o bootstrap e escrita direta, inclusive `UPDATE` do papel.
- **Lado do Owner:** o gatilho de constraint `owner_platform_separation` em `organization_members`,
  **conferido no commit** (`DEFERRABLE INITIALLY DEFERRED`), recusa que uma conta com papel de
  plataforma vire Owner de uma organização de cliente por qualquer caminho:
  - mudança de papel;
  - transferência de propriedade;
  - aceite de convite de Owner;
  - criação de organização.

A primeira revisão independente mostrou o contorno pelo lado do papel: revogar o papel de um admin,
atribuir a ele uma organização sem Owner e devolver o papel. A segunda mostrou o contorno pelo lado do
Owner: rebaixar o operador por uma conta controlada por ele, devolver o papel e promovê-lo de novo.

Os dois lados tomam o mesmo lock por conta (`platform_user:<id>`), sempre depois do lock da organização,
e recusam níveis de isolamento acima de READ COMMITTED.

**Consequência:** um admin da plataforma **não pode criar uma organização de cliente**, porque seria o
Owner dela. Para ter um restaurante próprio, use outra conta. `admin_set_platform_role` também recusa
um e-mail de duas contas (`user_ambiguous`) e nunca concede papel a conta apagada. Restaurantes de teste (`is_demo`, criados por
`create_test_restaurant`) ficam de fora: são fictícios. Linhas que já existiam não são alteradas; o checklist
de publicação lista, somente leitura, quem tem papel de plataforma e é Owner de organização de cliente.

### Concorrência

Todas as formas de alguém virar Owner tomam o mesmo lock por organização, pelo gatilho
`member_owner_serialize` (BEFORE INSERT ou UPDATE OF role, quando `role = 'owner'`):
- aceite de convite;
- transferência de propriedade;
- mudança de papel;
- criação de organização.

A função toma esse lock antes de procurar Owners. Em READ COMMITTED cada instrução vê o que foi
confirmado antes dela, então a verificação 6 enxerga qualquer Owner gravado enquanto a chamada
esperava. Ensaiado com duas sessões reais:

| Cenário | Resultado |
|---|---|
| Dois admins na mesma organização sem Owner, com COMMIT | O segundo espera e recebe `owner_exists` |
| Dois admins na mesma organização sem Owner, com ROLLBACK | O segundo espera e atribui |
| Convite de Owner aceito antes | O admin espera e recebe `owner_exists` |
| Admin antes | O aceite espera e grava; o convidado foi chamado pelo Owner anterior, que é um caminho legítimo |
| Atribuição antes, papel de plataforma concedido ao mesmo tempo | A concessão espera e é recusada (`platform_role_owner_conflict`) |
| Papel concedido antes | A atribuição espera e é recusada (`platform_user_forbidden`) |

## Decisões de desenho

- **`support` também é recusado como alvo:** operador e Owner continuam pessoas diferentes.
- **Conta banida (`banned_until`) conta como Owner ativo:** é a opção conservadora. Recuperar uma
  organização cujo Owner foi banido exige o procedimento manual de disputa abaixo.
- **Restaurantes de teste** (`create_test_restaurant`) continuam permitidos a admins da plataforma. A
  verificação no commit existe por causa deles: a organização só é marcada como demo depois de o
  Owner ser inserido.
- **Linhas antigas:** se uma conta já tinha papel de plataforma e era Owner de organização de
  cliente antes da 0034, nada muda nela. Mas conceder o mesmo papel de novo, ou alterar essa linha
  de papel, passa a ser recusado.

## Riscos residuais (decisão do responsável)

- **Deadlock raro:** dois Owners da mesma organização transferindo a propriedade um para o outro ao
  mesmo tempo podem receber `deadlock detected` (40P01) numa das chamadas. Isso acontece porque o
  gatilho toma o lock da organização depois do lock da linha. Não há perda de integridade: uma
  transação é desfeita inteira. Evitar exigiria tomar o lock no início de `transfer_ownership`,
  `set_member_role` e `accept_invitation` (fora deste escopo).

- **Organização sem Owner ativo:** um admin ainda pode atribuí-la a uma conta comum que ele
  controle. Mitigações possíveis, fora deste escopo:
  - aprovação por duas pessoas (um admin solicita, outro aprova);
  - MFA obrigatório nos `admin_*` (`auth.jwt()->>'aal' = 'aal2'`).
- **Disputa de propriedade com Owner existente:** não há fluxo no app. É um procedimento manual,
  com verificação de identidade e auditoria.
- **E-mail ambíguo:** duas contas com o mesmo e-mail (maiúsculas ou SSO) são recusadas; é preciso
  resolver a duplicidade antes.
- **Tela:** o botão continua aparecendo por `owner_count = 0`, que conta também Owners inativos.
  Uma organização cujo único Owner foi apagado não mostra o botão. A tela é mais restritiva que o
  banco, nunca menos.

## Testes

- `scripts/security/admin_assign_owner_integrity.mjs` (passo 5i da suíte; 56 verificações). Cobre:
  - casos legítimos;
  - recusas, cada uma conferida para não mudar nada;
  - a concorrência acima;
  - níveis de isolamento;
  - isolamento entre organizações;
  - a separação entre operador e Owner (X1–X12):
    - revogar → atribuir → devolver;
    - rebaixar → devolver o papel → promover;
    - transferência de propriedade;
    - convite de Owner;
    - criação de organização (e de restaurante de teste);
    - isolamento;
    - `UPDATE` de papel;
    - e-mail ambíguo;
    - concorrência entre atribuição e concessão;
  - privilégios.
- Controle negativo: o mesmo script contra um banco em 0033 falha (números no relatório de validação).
- `src/test/security-closure-migrations.test.ts`: revisão do arquivo.

## Rollback

`docs/operations/security-closure/0034-rollback.sql`, gerado, que vira uma migration nova revisada.
Ele restaura o corpo da 0001 e transforma as funções dos dois gatilhos em no-ops, sem `DROP TRIGGER`
(que travaria `organization_members` em ACCESS EXCLUSIVE). Ele **reabre a escalada**: só deve ser usado se a 0034 impedir uma operação legítima. Reaplicação:
rodar a 0034 de novo (idempotente). Procedimento em
[security-closure/README.md](security-closure/README.md).
