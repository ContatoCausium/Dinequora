# Salão, etapa 1: setores, mesas e status (migration 0037)

## O que é

Primeira etapa do módulo de salão (roadmap: "Mesas e comandas"). Cada loja passa a ter **setores**
(Varanda, Bar, Salão principal) e **mesas** com nome, lugares e um de quatro status: disponível,
ocupada, reservada ou limpeza. A tela fica em **Mesas** (`/tables`).

**Fora desta etapa:** sessão de atendimento, comanda, itens, envio ao KDS, divisão de conta e
pagamentos. "Ocupada" aqui é um status marcado à mão. Na etapa 2, abrir uma comanda marca a mesa
como ocupada e ela continua assim enquanto houver comanda aberta.

## Desligado por padrão

O módulo fica atrás da funcionalidade `table_service` (catálogo da 0022), **desligada para todas as
organizações**. Enquanto estiver desligada, para todos os papéis, proprietário incluído:

- as três permissões não contam e não aparecem em `my_permissions`;
- o item Mesas não aparece no menu;
- as leituras não devolvem nada e as escritas são recusadas com `permission_denied`.

Aplicar a 0037 não muda nada para nenhuma organização. Só um administrador da plataforma liga o
módulo, com `admin_set_org_feature(org, 'table_service', true)`, que fica auditado.

## Permissões

| Permissão | O que permite |
|---|---|
| `tables.view` | ver o salão |
| `tables.status` | mudar o status de uma mesa |
| `tables.manage` | criar, editar e arquivar setores e mesas |

Quem recebe cada uma por padrão:

- **Proprietário:** as três, porque tem o catálogo inteiro.
- **Gerente sem perfil:** as três, porque os padrões do gerente derivam do catálogo.
- **Perfis de sistema:**
  - `org_admin` e `manager`: as três;
  - `cashier` (frente de loja): `view` e `status`;
  - `kitchen`, `stock` e `finance`: nenhuma.
- **Equipe sem perfil:** nenhuma. Um proprietário concede por membro ou por perfil, e o teto da
  equipe permite as três.
- **Perfis personalizados:** não são alterados.

A 0037 redefine só `permission_catalog()`. `role_ceiling` e `role_default_permissions` não mudam.

## Banco

| Objeto | Função |
|---|---|
| `dining_sections` | setores por loja; nome único entre os ativos (sem diferenciar maiúsculas) |
| `dining_tables` | mesas por loja; nome único entre as ativas; mesa e setor sempre na mesma loja (FK composta) |
| `dining_table_status_events` | histórico: de que status, para qual, quem e quando |

- **Leitura (RLS):** qualquer uma das três permissões **e** acesso à loja (`can_access_location`).
  As políticas não usam `accessible_location_ids()`, que é da M2 e seria removida por um rollback
  da M2.
- **Escrita:** nenhuma direta, para ninguém. Só pelas cinco RPCs abaixo, todas `SECURITY DEFINER`.
  Cada uma verifica membro, loja da organização, loja ativa, organização operante
  (`assert_operational_scope`), a permissão na loja e a funcionalidade (`assert_permission`).

| RPC | Permissão | Auditoria |
|---|---|---|
| `save_dining_section(org, loja, nome, ordem, id?)` | `tables.manage` | `tables.section_saved` |
| `archive_dining_section(org, loja, id)` | `tables.manage` | `tables.section_archived` |
| `save_dining_table(org, loja, nome, lugares, ordem, id?, setor?)` | `tables.manage` | `tables.table_saved` |
| `archive_dining_table(org, loja, id)` | `tables.manage` | `tables.table_archived` |
| `set_dining_table_status(org, loja, id, status, status_esperado?)` | `tables.status` | histórico próprio |

A auditoria fica no escopo da loja. Mudanças de status não vão para a auditoria, para não inundar o
registro de atividade da equipe; ficam no histórico próprio.

## Regras

- **Arquivar, nunca apagar.** A etapa 2 liga mesas a sessões e comandas, e o histórico precisa
  continuar apontando para elas. O nome de uma mesa arquivada pode ser reutilizado.
- **Mesa ocupada** não pode ser arquivada (`table_occupied`).
- **Setor com mesa ativa** não pode ser arquivado (`section_not_empty`).
- **Mudar para o status atual** não grava nada.

## Concorrência

Em READ COMMITTED, o padrão da API:

- **Status:** a tela envia o status que mostrava. A RPC trava a mesa (`FOR UPDATE`) e, se o status
  mudou nesse meio-tempo, não grava nada e responde `status_conflict` com o status atual. A tela
  avisa e recarrega. Duas pessoas nunca desfazem a mudança uma da outra em silêncio.
- **Setor arquivado × mesa salva nele:**
  - salvar a mesa trava o setor com `FOR SHARE`;
  - arquivar o setor trava com `FOR UPDATE` e confere as mesas ativas;
  - em qualquer ordem, nunca fica uma mesa ativa num setor arquivado.
- **Nomes duplicados:** os índices únicos parciais barram o segundo, que recebe
  `table_label_taken` ou `section_name_taken`.

## Testes

- **Banco:** `scripts/security/dining_tables_integrity.mjs`, passo 5l da suíte de segurança, nos
  dois modelos de privilégio. Cobre:
  - a funcionalidade desligada e depois ligada para uma organização só;
  - cada papel e perfil;
  - segunda loja e outra organização;
  - acesso anônimo e escritas diretas;
  - validações e regras de arquivamento;
  - histórico e auditoria;
  - organização suspensa;
  - os três casos de concorrência, com COMMIT e ROLLBACK.
- **Tela:** `src/test/tables-page.test.tsx`.
- **Paridade do catálogo:** `src/test/permissions.test.ts`.

## Rollback (uma migration NOVA)

1. Remover as cinco RPCs e as três tabelas.
2. Restaurar `permission_catalog()` da 0032.
3. Tirar as três permissões dos perfis de sistema e recalcular `effective_permissions`.
4. Apagar as linhas de `feature_permissions` e a de `feature_catalog`.

O rollback do M2 (`docs/operations/m2-rollback`) usa o catálogo **como está na ponta**, sem
`orders.resolve_pending`, e por isso não remove as permissões de mesas.
