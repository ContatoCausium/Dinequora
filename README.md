# Servora

Restaurant operations with tenant/store-scoped authorization. The operational database was **reconstructed from application contracts**, not recovered from the original database.

## Handoff

See [Portuguese technical handoff](docs/operations/backend-reconstruction-handoff.md) for applied migrations, verified tests, limitations and workspace import instructions. Do not treat passing mocked tests as production approval.

## Local validation

```sh
bun install --frozen-lockfile
bun run dev
bunx tsgo --noEmit -p tsconfig.json
bunx vitest run
bun run build
```

Copy `.env.example` to your local environment and configure only the intended development backend. Never commit real environment files. Hosted configuration is managed by Lovable Cloud.

Migrations are plain PostgreSQL SQL under `drizzle/migrations`, applied in journal order by the managed migration tool. Do not use Drizzle ORM models or regenerate schema from `drizzle/schema.ts`. Empty-environment replay requires managed auth schemas/roles, `auth.uid()`, extensions and Realtime prerequisites. Do not run the security fixture scripts against a customer database.

## Marketing website

The public Dinequora marketing site is a separate Vite project in [`website/`](website/README.md)
with its own dependencies and CI job. It does not touch the app, Supabase or migrations.

## Template information

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
