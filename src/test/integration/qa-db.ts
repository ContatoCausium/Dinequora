// SQL access for the database integration tests (disposable QA/CI stack only): psql on the CI
// runner, otherwise the one inside the QA database container. The statements are sent on stdin, so
// a fixture may contain several statements and its own transaction.
import { execFileSync } from "node:child_process";
import { assertDisposableApi } from "../../../scripts/guard/target-guard.mjs";

function hasPsql(): boolean {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export type QaSql = (query: string) => string;

export function qaSql(): QaSql {
  const dbUrl = process.env["QA_DB_URL"];
  if (dbUrl && !/@(127\.0\.0\.1|localhost):\d+\/postgres$/.test(dbUrl))
    throw new Error("refusing: QA_DB_URL is not a local database");
  const usePsql = Boolean(dbUrl) && hasPsql();
  const args = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  return (query) => {
    const out = usePsql
      ? execFileSync("psql", [dbUrl!, ...args], { input: query })
      : execFileSync(
          "docker",
          [
            "exec",
            "-i",
            `supabase_db_${process.env["QA_PROJECT"]}`,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            ...args,
          ],
          { input: query },
        );
    return out.toString().trim();
  };
}

/**
 * The SQL channel and the API of a DISPOSABLE stack, or a refusal before anything is written
 * (scripts/guard/target-guard.mjs). Both channels the tests write with are checked: the database
 * reached by qaSql() (psql URL or container) attests it carries a valid marker, and the database
 * behind the API attests the same through the service role.
 */
export async function disposableQa(apiUrl: string | undefined, operation: string): Promise<QaSql> {
  if (!/^[a-z][a-z0-9:._-]{2,80}$/.test(operation)) throw new Error("invalid operation name");
  const sql = qaSql();
  sql(`DO $$ BEGIN
         IF to_regprocedure('dq_guard.attest(text)') IS NULL THEN
           RAISE EXCEPTION 'refused by the target guard: not a disposable database (no dq_guard marker)';
         END IF;
         PERFORM dq_guard.attest('${operation}');
       END $$;`);
  await assertDisposableApi(apiUrl, process.env["SB_SERVICE"], operation);
  return sql;
}

/**
 * Fixed reference instant for synthetic orders: the tests never depend on the wall clock, so the
 * same data always sorts the same way, whatever else exists in the database.
 */
export const T0 = "timestamptz '2026-01-01 12:00:00+00'";
