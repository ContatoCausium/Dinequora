# Verificação em duas etapas (MFA com app autenticador)

## O que é

Cada pessoa ativa a verificação em **Configurações › Segurança** (`/settings/security`):
1. escaneia o QR code com um app autenticador (Google Authenticator, Microsoft Authenticator,
   1Password, Authy…), ou digita a chave mostrada;
2. confirma com o primeiro código de 6 dígitos.

Depois disso, todo login pede o código do app logo após a senha (`/mfa`). A pessoa pode remover o
autenticador, o que exige uma sessão já verificada com o código.

## Como funciona

- Usa o MFA TOTP do Supabase Auth, pela camada `AuthService` (`auth.mfa` em
  `src/lib/auth/supabase-adapter.ts`). A interface nunca fala direto com o cliente de autenticação.
- **Níveis da sessão:** `aal1` é só a senha; `aal2` é senha mais código. O portão das rotas
  autenticadas (`src/routes/_authenticated/route.tsx`) manda para `/mfa` toda sessão `aal1` de uma
  conta com autenticador confirmado.
- **Se o nível não puder ser lido** (falha de rede), ninguém fica trancado do lado de fora. O backend
  continua aplicando o que aplica.
- **Tentativa abandonada:** um autenticador não confirmado, deixado para trás, é limpo na próxima.

## Configuração por ambiente

- **Local e CI:** `[auth.mfa.totp] enroll_enabled = true` e `verify_enabled = true` em
  `scripts/qa/supabase/config.toml` e `supabase/config.toml`.
- **Projetos hospedados do Supabase:** o TOTP vem ativo por padrão. Conferir em Authentication ›
  Multi-Factor antes de anunciar o recurso.

## Próximo passo (não incluído)

**Exigir** MFA de proprietários e administradores. Isso pode ser feito com uma regra no banco (RLS e
RPCs sensíveis exigindo `aal2` em `auth.jwt()`) e um aviso no app até a pessoa ativar. Fica para uma
migration própria, porque muda o acesso de quem ainda não ativou.

## Testes

- **`src/test/mfa.test.tsx`:**
  - ativar: QR, chave, formato inválido, código errado explicado, código certo ativa;
  - remover com confirmação;
  - portão: sessão `aal1` de conta com autenticador vai para `/mfa`; sessão `aal2` ou conta sem
    autenticador entra.
- **No navegador**, contra uma stack descartável com TOTP ligado: ativar, código errado recusado,
  código certo calculado da chave de teste, ativado, removido. A conta de teste voltou a ficar sem
  autenticador.
