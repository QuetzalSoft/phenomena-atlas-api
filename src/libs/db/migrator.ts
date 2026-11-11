import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Kysely } from "kysely";
import { FileMigrationProvider, type MigrationResultSet, Migrator } from "kysely/migration";
import type { Database } from "./database.js";

// This file sits at the same depth in src/ and in dist/, so the path holds for both.
const migrationFolder = fileURLToPath(new URL("../../../database/migrations", import.meta.url));

/**
 * Runs the migrations in `database/migrations/`. They stay TypeScript and are loaded as they
 * are, which Node supports for files that only use erasable syntax.
 */
export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({ db, provider: new FileMigrationProvider({ fs, path, migrationFolder }) });
}

/** Throws the error a migration run stopped at. Kysely returns it instead of throwing. */
export function throwIfFailed({ error }: MigrationResultSet): void {
  if (error) {
    throw error instanceof Error ? error : new Error("Migration failed.", { cause: error });
  }
}
