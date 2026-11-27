# Assistente de gestão com IA (migration 0040)

## O que é

Na página **Insights**, quem tem a permissão `assistant.use` vê o painel **"Pergunte ao
assistente"**. A pessoa pergunta, em português ou inglês, sobre vendas, custos, mais vendidos,
estoque e pedidos. O **Claude** (Anthropic, modelo `claude-opus-5-5`) responde a partir dos dados do
restaurante.

O assistente **nunca altera nada**: não vende, não estorna, não muda preço nem estoque. Quando pedem
uma ação, ele indica onde fazer no Dinequora.

## Desligado por padrão, em três camadas

1. **Funcionalidade `ai_assistant`:** desligada para todas as organizações. Um administrador da
   plataforma liga por organização com `admin_set_org_feature`. Desligada, ninguém tem a permissão,
   nem o proprietário.
2. **Permissão `assistant.use`:**

   | Quem | Tem por padrão |
   |---|---|
   | Proprietário | sim |
   | Gerente sem perfil | sim |
   | Perfis de sistema `org_admin` e `manager` | sim |
   | Equipe | só por concessão |

3. **Chave da API:** a variável `ANTHROPIC_API_KEY` vive **só no servidor**, como segredo do Worker.
   Sem chave, o painel responde "o assistente ainda não foi configurado" e **nada é enviado a lugar
   nenhum**.

## O que é enviado ao modelo

O servidor monta um **retrato compacto** dos dados (`src/lib/assistant-snapshot.ts`). Tudo é lido
**pela RLS, como a pessoa que perguntou**: o modelo nunca vê mais do que ela vê no Dinequora. Uma
parte que ela não pode ler vai como "não disponível", nunca como zero.

O retrato tem:
- **Razão financeiro dos últimos 30 dias:** vendas líquidas, CMV e despesas, por dia e por loja.
- **Mais vendidos dos últimos 30 dias:** pratos pedidos (pedidos não cancelados), lidos de
  `menu_item_sales` (0042), agregados no banco: sem o antigo limite de 2.000 pedidos, que num mês
  movimentado cortava a lista sem aviso.
- **Engenharia de cardápio dos últimos 30 dias** (a mesma classificação da tela de Insights): classe,
  vendidos, preço médio, custo da ficha e margem por unidade de cada prato, e os pratos vendidos sem
  custo de ficha. Só vai quando a pessoa pode ver custos (`inventory.costs`); senão vai como "não
  disponível".
- **Estoque** no mínimo ou abaixo dele.
- **Previsão de compras para 7 dias** (a mesma conta da aba Pedidos de compra, 0044): item, loja, estoque,
  uso por dia, quantos dias dura, quanto comprar e fornecedor; mais os itens no mínimo sem uso em vendas,
  sem quantidade inventada.
- **Pedidos abertos agora.**
- **Lojas e fusos.**

**Não são enviados:** dados de clientes, nomes ou e-mails de funcionários, senhas, chaves, dados de
cartão nem o custo de cada item de estoque (só o custo da ficha por prato, para quem já vê custos).

As instruções do modelo (`SYSTEM_PROMPT` em `src/lib/assistant.functions.ts`) mandam:
- usar só o retrato;
- dizer o que falta;
- não inventar números;
- responder no idioma da pergunta;
- tratar sugestões como sugestões.

O pedido ao modelo inclui:
- **fallback de recusa do lado do servidor** (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`);
- **cache do prompt de sistema**;
- **esforço `medium`**.

## Custo e controle

- **Registro de uso:** cada pergunta respondida grava em `assistant_usage` quem perguntou, a loja,
  o modelo e os tokens de entrada e saída. **A pergunta e a resposta não são guardadas.** A auditoria
  (`assistant.asked`) registra só o tamanho da pergunta e os tokens.
- **Limite mensal por organização:** a variável `ASSISTANT_MONTHLY_TOKEN_CAP` (padrão de 2.000.000 de
  tokens). Antes de cada pergunta, o servidor compara com `assistant_month_tokens()`. Atingido o
  limite, o painel avisa e nada é enviado.
- **Quem vê o uso:** o proprietário vê o uso da organização inteira; os demais, só o próprio.
- **Preço de referência do `claude-opus-5-5`:** US$ 4 por milhão de tokens de entrada e US$ 20 por
  milhão de saída. Uma pergunta típica com o retrato fica na casa de alguns milhares de tokens.

## Para ligar (depende de decisão e autorização)

1. Criar a chave da API na conta da empresa na Anthropic.
2. Gravar `ANTHROPIC_API_KEY` (e, se quiser, `ASSISTANT_MONTHLY_TOKEN_CAP`) como segredo do Worker
   do ambiente.
3. Aplicar a 0040 no Supabase do ambiente.
4. Ligar `ai_assistant` para a organização.
5. Decidir em quais planos o assistente entra.

## Testes

- **`scripts/security/assistant_usage_integrity.mjs`** (passo 5o da suíte), com 22 verificações:
  - funcionalidade desligada e depois ligada para uma organização só;
  - quem pode registrar;
  - outra organização, anônimo e valores inválidos;
  - nenhuma escrita direta;
  - leitura do proprietário e do gerente;
  - total do mês;
  - auditoria sem a pergunta.
- **`src/test/assistant.test.tsx`:**
  - o retrato (estornos descontados, totais de 7 e 30 dias, mais vendidos só de pedidos pagos,
    estoque baixo, partes indisponíveis continuam nulas);
  - o painel (pergunta com escopo e histórico, aviso de "não configurado").
- **Ainda não testado:** uma chamada real ao modelo, porque depende da chave e gera custo.

## Rollback (uma migration NOVA)

1. Remover `record_assistant_usage`, `assistant_month_tokens` e `assistant_usage`.
2. Restaurar `permission_catalog()` da 0038.
3. Tirar `assistant.use` dos perfis de sistema e de `feature_permissions`.
4. Apagar a linha da funcionalidade e recalcular `effective_permissions`.
