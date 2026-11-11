import { type Kysely, sql } from "kysely";

// Admins filter accounts by a substring of the username, name or email (ILIKE '%text%').
// A B-tree cannot serve a leading wildcard; trigram GIN indexes can, once the text has three
// or more characters.
const columns = ["username", "name", "email"] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);
  for (const column of columns) {
    await sql`CREATE INDEX ${sql.id(`account_${column}_trgm_idx`)} ON account USING gin (${sql.id(column)} gin_trgm_ops)`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const column of columns) {
    await db.schema.dropIndex(`account_${column}_trgm_idx`).execute();
  }
  // Without CASCADE, so this fails rather than drop an index something else added.
  await sql`DROP EXTENSION IF EXISTS pg_trgm`.execute(db);
}
