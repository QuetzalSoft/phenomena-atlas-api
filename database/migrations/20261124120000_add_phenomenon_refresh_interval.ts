import { type Kysely, sql } from "kysely";

// Each phenomenon's refresh interval. See docs/adr/0015-phenomenon-refresh-interval.md in the
// system repository: whole minutes, from 5 to 30 days, and existing phenomena get 60.
export async function up(db: Kysely<unknown>): Promise<void> {
  // The default fills the phenomena already saved.
  await db.schema
    .alterTable("phenomenon")
    .addColumn("refresh_interval_minutes", "integer", (column) =>
      column.notNull().defaultTo(60).check(sql`refresh_interval_minutes BETWEEN 5 AND 43200`),
    )
    .execute();
  // Then it goes, so that the 60 a new phenomenon starts with lives only in the domain.
  await db.schema
    .alterTable("phenomenon")
    .alterColumn("refresh_interval_minutes", (column) => column.dropDefault())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("phenomenon").dropColumn("refresh_interval_minutes").execute();
}
