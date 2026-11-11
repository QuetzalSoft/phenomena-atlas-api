import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("account")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // The identity provider's id for the person: the access token's `sub`.
    .addColumn("subject", "text", (column) => column.notNull().unique())
    .addColumn("username", "text")
    .addColumn("name", "text")
    .addColumn("email", "text")
    // Text with a check rather than an enum type: adding a role stays a one-line migration.
    .addColumn("role", "text", (column) =>
      column.notNull().defaultTo("user").check(sql`role IN ('user', 'analyst', 'admin')`),
    )
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // Accounts are listed oldest first, paged by (created_at, id).
  await db.schema.createIndex("account_created_at_id_idx").on("account").columns(["created_at", "id"]).execute();
  // Operators look accounts up by email when granting a role.
  await db.schema
    .createIndex("account_email_idx")
    .on("account")
    .expression(sql`lower(email)`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("account").execute();
}
