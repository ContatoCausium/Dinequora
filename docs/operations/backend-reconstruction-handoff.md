# Servora — reconstrução operacional e handoff

## Estado e limites

Foi utilizado exclusivamente o Lovable Cloud de desenvolvimento vinculado a este workspace. O banco original não foi consultado nem modificado. Esta é uma **reconstrução compatível com contratos atuais**, não uma recuperação comprovada do schema original. Organizações, usuários, assinaturas e registros legados em quarentena foram preservados; não houve importação de dados comerciais, conexão Stripe, envio de mensagens ou publicação.

## Objetos e migrations

- `0012_reconstructed_operational_schema`: Menu (`menu_categories`, `menu_products` com modificadores JSON), pedidos (`orders`, `order_items`, `order_item_modifiers`, `order_status_history`, `payments`), estoque (`inventory_items`, `inventory_movements`), fichas (`product_recipes`, `recipe_ingredients`), compras (`suppliers`, `purchase_orders`, `purchase_order_items`, `purchase_receipts`), financeiro (`finance_entries`) e WhatsApp simulado (`whatsapp_records`). Enums `order_type`/`order_status`, índices por organização/loja/data, unicidades de idempotência, chaves compostas, RLS e triggers de validação de loja.
- `0013_reconstructed_pos_transactions`: `create_pos_sale`, `finalize_pos_sale_atomic`, `persist_finalized_pos_sale_atomic`, `cancel_order_with_reversal`, `update_order_status`, `set_order_item_ready`, gravação/arquivamento de Menu, conversão de unidades, preços/modificadores calculados no servidor, consumo/CMV/receita e reversão atômicos.
- `0014_reconstructed_inventory_receiving`: despesas (`finance_expenses`), gravação auditada de recursos, movimentos/transferências, recebimentos parciais e cancelamento de compras não recebidas.
- `0015_receiving_alias_and_request_validation`: corrige alias ambíguo encontrado no teste PostgreSQL e valida insumos.
- `0016_operational_idempotence_hardening`: fingerprint de movimentos e validações adicionais de modificadores.

Todas foram aplicadas no banco vinculado, sem reset. Inventário final verificado: **31 tabelas públicas, 31 com RLS**, preservando as 13 preexistentes. Helpers existentes reutilizados: `is_org_member`, `is_org_owner`, `can_access_location`, `can_operate_location`, `can_manage_org`, `assert_org_operational`, `write_audit`. RPCs operacionais exigem usuário autenticado, verificam organização/loja e possuem `search_path` definido; não são executáveis por `anon`. Escritas diretas não são concedidas a clientes.

`can_operate_location` exige `can_access_location`, organização operacional e loja ativa. Portanto uma loja operável também é legível; RLS protege consultas abrangentes de pedidos. Proprietários são org-wide; demais membros dependem de `member_location_access`. As políticas e definições completas estão no SQL versionado, não em objetos implícitos.

## Integração executada

- Menu, POS e KDS chamam funções autenticadas em `src/lib/operational.functions.ts`; slugs da interface são resolvidos para UUIDs por leituras RLS do usuário.
- POS só retorna conclusão após RPC e leitura de confirmação; requisições usam chave de idempotência. Preços e modificadores vêm do servidor.
- Pedidos, estados, itens prontos e cancelamentos usam RPCs auditadas. KDS consulta registros persistidos, com consulta periódica de segurança.
- Estoque/fichas, criação de fornecedor/compra, recebimento e transferências têm integração persistida. Cadastro de receita exige produto existente e ingredientes da mesma loja.
- Financeiro lê ledger/despesas e grava alterações de despesas no servidor. DRE utiliza receita/CMV registrados, sem baseline fictício.
- Intelligence consome recursos registrados; WhatsApp persiste contatos consentidos e registros simulados. Não há provedor de envio.
- Dashboard de organizações reais usa dados registrados; demonstração permanece separada.

Arquivos principais modificados: `orders-backend.ts`, `orders-persistence-service.ts`, `pos-service.ts`, rotas Menu/POS/KDS/Inventory/Finance/Intelligence/Overview, cartão WhatsApp, traduções, testes, README, AGENTS e roadmap. Novos: `operational-contracts.ts`, `operational.functions.ts`, `operational-mappers.ts`, `operational-metrics.ts`, diálogos de cadastro e overview registrado, migrations 0012–0016 e scripts de regressão. Tipos do banco foram regenerados automaticamente.

## Validação e evidências

- TypeScript strict preservado: `strict`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` permanecem `true`; a verificação automática mais recente e compilação constam como `build OK`.
- Suíte Vitest: **192/192 testes em 29 arquivos**. Os testes de fluxo `e2e-operational-flow.test.ts` exercitam contratos com **mocks de funções servidor**, não são E2E hospedados. As três antigas falhas de indisponibilidade foram substituídas pela implementação e testes de contrato; isto isoladamente não prova operação real.
- PostgreSQL descartável: migrations reexecutadas em ambiente isolado com bootstrap equivalente. Passaram preços/impostos, consumo de ficha/CMV, idempotência, KDS, estorno, isolamento entre organizações/lojas, bloqueio de staff/anon/escrita direta, conflito de chave e rollback por estoque insuficiente.
- Compras no PostgreSQL isolado: fórmula **15000 − 1000 + 1200 + 500 = 15700**, recebimentos parcial/total, repetição e conservação em transferência aprovados.
- Reforço isolado: repetição/conflito de movimento, consentimento obrigatório, rejeição de entrega fictícia e ausência de autenticação aprovados.
- Navegador: `/` encaminhou para login, sem erros JavaScript observados. **Nenhuma venda autenticada foi executada nas telas contra o banco hospedado**: não existe sessão de teste autorizada disponível para o solicitante. O teste de aceitação existente informou que bloqueou mutação por não identificar organização demo isolada; não deve ser interpretado como homologação.

## Pendências e riscos antes de produção

1. Conta de teste autorizada: validar Menu → venda → recarga → KDS → estorno no banco vinculado e conferir estoque/ledger por leitura na interface. Repetir com proprietário, gerente e staff em duas organizações/lojas. Não criar acesso administrativo por suposição.
2. Financeiro por produto ainda possui custos/unidades zero em agregações específicas; fluxo de caixa e gráficos antigos exigem reconciliação temporal com o ledger. Intelligence ainda não fornece insights detalhados. Não tratar estes relatórios como demonstrativos contábeis homologados.
3. Mapper de receitas ainda apresenta custos zero em campos agregados; unidades aceitas no banco/UI precisam de alinhamento integral (especialmente galões no formulário). Consumo no servidor tem conversão e bloqueia unidades incompatíveis, mas estimativas da interface precisam de revisão.
4. Sessões POS não possuem persistência completa de rascunho; catálogo utiliza modificadores JSON, não recupera as tabelas originais de modificadores. Categorias de estoque permanecem valores do contrato, não cadastro dedicado.
5. Realtime de itens prontos requer validar publicação/assinatura de `order_items`; polling não comprova atualização instantânea. Pedidos persistidos são acessados pelo KDS/adaptador, não foi homologada uma tela separada de histórico.
6. Compras recebidas não podem ser canceladas: devolução de compra ainda não implementada. Cadastro de compra simplificado cria um item; interfaces de edição mais amplas precisam homologação.
7. WhatsApp: contatos/registros persistidos, mas templates/configurações/agendamentos ainda têm caminhos locais/simulados; não há cron, entrega nem webhooks homologados. Stripe e emails dependem de configuração externa autorizada e permanecem desconectados/não verificados.
8. Revisão independente de segurança e carga concorrente; verificar arredondamento de custos e datas de competência, preços/impostos permitidos por papel. Produtos sem ficha não consomem estoque: configurar fichas antes de uso comercial.

## Reprodução e reversibilidade segura

Aplicar 0000–0016 em ordem do journal usando a ferramenta de migrations do novo workspace, **somente após confirmar que o backend alvo é novo/isolado**. Pré-requisitos gerenciados: roles `anon`/`authenticated`/`service_role`, schema `auth` com `auth.users`/`auth.uid()`, `extensions`, pgcrypto e publicação Realtime. O bootstrap de teste não é substituto do serviço de autenticação.

A fixture `scripts/security/reconstructed_operations.sql` (que reúne as antigas `reconstructed_operations/purchases/hardening`) roda numa única transação encerrada com ROLLBACK, com ids, e-mails e slugs novos a cada execução, e recusa rodar sem o opt-in `dinequora.fixture_target=disposable`, que só `scripts/qa/security-suite.sh` define, e só depois de confirmar que o banco é novo e vazio. As versões anteriores gravavam dados com identidades literais (organizações Test A/B) e deixaram essas linhas em bancos onde rodaram. Mesmo assim, nunca executar fixtures no banco hospedado de clientes. Não migrar usuários ou dados locais automaticamente. Rollback de aplicação deve desativar operações afetadas e conservar tabelas/ledger; mudanças do banco são corrigidas por migrations aditivas. Não remover histórico financeiro nem fazer reset.

## GitHub e novo workspace

O destino solicitado é `ContatoCausium/Servora`, `main`. Os remotos disponíveis no ambiente são internos do Lovable; **não foi comprovada conexão/push para esse GitHub**. Commits do ambiente são gerenciados automaticamente pela plataforma; não executei commits/push/force push manuais. Branch/commit podem mudar automaticamente: conferir a exportação e o último estado no editor antes de sincronizar.

1. Baixar a exportação de fonte anexada; inclui código, lock, configuração, traduções, testes, migrations e documentação, sem `.env`, metadados Git, dependências ou build.
2. Nas configurações do projeto, verificar GitHub → repositório e branch realmente conectados. Se necessário, conectar somente o destino aprovado; conferir mudanças e criar revisão para `main` sem sobrescrever histórico.
3. No novo workspace, importar o repositório/exportação. Não conectar por suposição ao banco antigo. Ativar/vincular o Lovable Cloud desejado e confirmar a identidade do desenvolvimento antes de qualquer migration.
4. Configurar valores públicos do novo backend usando `.env.example` apenas como lista; credenciais privadas ficam nos segredos do workspace, nunca no ZIP/GitHub.
5. Aplicar histórico em backend vazio isolado; gerar tipos pelo mecanismo gerenciado. Se reutilizar backend existente, não repetir schema já aplicado: conferir journal e catálogo primeiro.
6. Executar `bun install --frozen-lockfile`, `bunx tsgo --noEmit -p tsconfig.json`, `bunx vitest run`, `bun run build`. Homologar autenticação, redirects e operações reais com conta autorizada.
7. Configurar Stripe, sender de email e WhatsApp somente em etapa autorizada; validar respostas/webhooks reais antes de apresentar sucesso.

**Conclusão:** núcleo operacional reconstruído e conectado no código; testes isolados aprovados. Integração autenticada hospedada, relatórios completos e GitHub `main` permanecem não homologados. Não publicado, não pronto para produção.