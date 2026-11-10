/**
 * Tests for the migration gate (scripts/qa/check-migrations.mjs, files mode). Each case copies the
 * real migrations, manifest and package files into a temporary directory, breaks one rule and
 * runs the checker against the copy. The repository itself is never modified.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO, "scripts/qa/check-migrations.mjs");
const temps: string[] = [];

function sandbox(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dq-migcheck-"));
  temps.push(dir);
  fs.cpSync(path.join(REPO, "drizzle"), path.join(dir, "drizzle"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts/qa"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts/qa/migration-hashes.json"),
    path.join(dir, "scripts/qa/migration-hashes.json"),
  );
  for (const f of ["package.json", "package-lock.json"])
    fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  return dir;
}

function check(root: string, ...args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, CHECK_MIGRATIONS_ROOT: root };
  delete env["DB_URL"];
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const migration = (root: string, tag: string) =>
  path.join(root, "drizzle/migrations", `${tag}.sql`);
const journalFile = (root: string) => path.join(root, "drizzle/migrations/meta/_journal.json");
type JournalEntry = { idx: number; tag: string; when: number };
type Journal = { entries: JournalEntry[] };
type Manifest = { migrations: Record<string, string> };
type Snapshot = { tables?: Record<string, unknown> };
type PackageJson = { devDependencies: Record<string, string> };
function editJson<T>(file: string, edit: (j: T) => void) {
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as T;
  edit(j);
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
}
function appendJournalEntry(root: string, tag: string) {
  editJson<Journal>(journalFile(root), (j) => {
    const last = j.entries.at(-1)!;
    j.entries.push({ ...last, idx: last.idx + 1, tag, when: last.when + 1000 });
  });
  fs.writeFileSync(migration(root, tag), "select 1;\n");
}

afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("migration gate (files mode)", () => {
  it("passes on the repository as committed", () => {
    const r = check(REPO);
    expect(r.out).toContain("PASS migration integrity and SQL-first policy");
    expect(r.code).toBe(0);
  });

  it("passes on an untouched copy", () => {
    expect(check(sandbox()).code).toBe(0);
  });

  it("accepts a CRLF checkout of an unchanged migration (hashes are LF-normalized)", () => {
    const root = sandbox();
    const f = migration(root, "0013_reconstructed_pos_transactions");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\r?\n/g, "\r\n"));
    expect(check(root).code).toBe(0);
  });

  it("fails when a historical migration is edited", () => {
    const root = sandbox();
    fs.appendFileSync(migration(root, "0018_member_permissions"), "\n-- edited\n");
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("history changed: 0018_member_permissions.sql");
  });

  it("fails when a known orphan is edited", () => {
    const root = sandbox();
    fs.appendFileSync(migration(root, "0011_create_pos_sale_and_idempotency"), "\n-- edited\n");
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("known orphan 0011_create_pos_sale_and_idempotency.sql was edited");
  });

  it("fails on a new .sql file outside the journal", () => {
    const root = sandbox();
    fs.writeFileSync(migration(root, "0090_stray"), "select 1;\n");
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("new migration outside the journal: 0090_stray.sql");
  });

  it("fails on a new journal entry without a recorded hash, and --add-new-hashes records it", () => {
    const root = sandbox();
    appendJournalEntry(root, "0090_example");
    const before = check(root);
    expect(before.code).toBe(1);
    expect(before.out).toContain("no recorded hash for 0090_example");

    const add = check(root, "--add-new-hashes");
    expect(add.out).toContain("recorded hashes for: 0090_example");
    expect(add.code).toBe(0);
    expect(check(root).code).toBe(0);
  });

  it("--add-new-hashes never overwrites the recorded hash of an edited migration", () => {
    const root = sandbox();
    fs.appendFileSync(migration(root, "0005_admin_org_insights"), "\n-- edited\n");
    const manifest = path.join(root, "scripts/qa/migration-hashes.json");
    const original = fs.readFileSync(manifest, "utf8");
    const r = check(root, "--add-new-hashes");
    expect(r.code).toBe(1);
    expect(r.out).toContain("history changed: 0005_admin_org_insights.sql");
    expect(fs.readFileSync(manifest, "utf8")).toBe(original);
  });

  it("fails when the manifest lists a migration that is not in the journal", () => {
    const root = sandbox();
    editJson<Manifest>(path.join(root, "scripts/qa/migration-hashes.json"), (m) => {
      m.migrations["0099_ghost"] = "0".repeat(64);
    });
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("hash manifest lists 0099_ghost");
  });

  it("fails when the journal order or numbering is broken", () => {
    const root = sandbox();
    editJson<Journal>(journalFile(root), (j) => {
      j.entries[5]!.when = j.entries[4]!.when;
    });
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("'when' not increasing");
  });

  it("fails when drizzle/schema.ts is no longer blank", () => {
    const root = sandbox();
    fs.appendFileSync(path.join(root, "drizzle/schema.ts"), 'export const t = pgTable("t", {});\n');
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("drizzle/schema.ts is not blank");
  });

  it("fails when a Drizzle snapshot describes tables (drizzle-kit generate ran)", () => {
    const root = sandbox();
    editJson<Snapshot>(path.join(root, "drizzle/migrations/meta/0016_snapshot.json"), (s) => {
      s.tables = { "public.example": { name: "example", columns: {} } };
    });
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("snapshot 0016_snapshot.json describes tables");
  });

  it("fails when drizzle-kit is not pinned to an exact version", () => {
    const root = sandbox();
    editJson<PackageJson>(path.join(root, "package.json"), (p) => {
      p.devDependencies["drizzle-kit"] = "^0.31.11";
    });
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain('drizzle-kit must be pinned to an exact version (found "^0.31.11")');
  });

  it("fails when the pinned drizzle-orm differs from the lockfile", () => {
    const root = sandbox();
    editJson<PackageJson>(path.join(root, "package.json"), (p) => {
      p.devDependencies["drizzle-orm"] = "0.45.3";
    });
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("drizzle-orm 0.45.3 in package.json differs from package-lock.json");
  });
});
