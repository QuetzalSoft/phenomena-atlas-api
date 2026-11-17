import { sql } from "kysely";
import { inject } from "vitest";
import { createDatabase } from "../../src/libs/db/database.js";

/** A copy of the database as the migrations leave it, made once per run by global-setup.ts. */
export const templateDatabase = "migrated_template";

/**
 * A new, migrated and empty database of its own, for a spec that needs state other specs
 * also set up, such as a region partition. Specs run in parallel, and the shared database
 * holds one partition, which regions.e2e-spec.ts owns. Returns its connection URL.
 */
export async function createIsolatedDatabase(name: string): Promise<string> {
  const shared = inject("databaseUrl");
  const db = createDatabase(shared);
  try {
    await sql`CREATE DATABASE ${sql.id(name)} TEMPLATE ${sql.id(templateDatabase)}`.execute(db);
  } finally {
    await db.destroy();
  }
  const url = new URL(shared);
  url.pathname = `/${name}`;
  return url.toString();
}
