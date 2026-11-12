import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

const url = process.env.LOVABLE_DB_MIGRATION_URL ?? "";

// Target guard (scripts/guard/target-guard.mjs, migrate-gate): every drizzle-kit command that can
// connect stops here unless the target allows it. A disposable database passes; the persistent QA,
// the demo or any other local database needs the confirmation that scripts/ops/db-ops.mjs sets after
// its own checks; a remote (hosted) database needs the release confirmation for that host. The gate
// reads the URL from the environment and never prints it. No URL: nothing can be written.
if (url) {
  const gate = path.join(process.cwd(), "scripts/guard/target-guard.mjs");
  if (!existsSync(gate))
    throw new Error(
      "refused: the target guard was not found (run drizzle-kit from the repository root)",
    );
  execFileSync(process.execPath, [gate, "migrate-gate"], { stdio: "inherit", env: process.env });
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: { url },
});
