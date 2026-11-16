import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("phenomenon")
    // An identity never hands out the same id twice, even after a delete.
    .addColumn("id", "integer", (column) => column.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("description", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("draft").check(sql`status IN ('draft', 'published', 'archived')`),
    )
    // The definition is checked by the API, which owns its rules (ADR 0012 in the system
    // repository), and is always read and written whole.
    .addColumn("characteristics", "jsonb", (column) => column.notNull())
    .addColumn("weighting_function", "jsonb", (column) => column.notNull())
    .addColumn("revision", "integer", (column) => column.notNull().defaultTo(1).check(sql`revision >= 1`))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // Phenomena are listed by name.
  await db.schema.createIndex("phenomenon_name_idx").on("phenomenon").expression(sql`lower(name), id`).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("phenomenon").execute();
}
