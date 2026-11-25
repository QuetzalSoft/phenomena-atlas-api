import { type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("account")
    // Keycloak keeps a first and a last name; the `name` column is the two together.
    .addColumn("first_name", "text")
    .addColumn("last_name", "text")
    // When the account's details were last edited through the API. A token issued before
    // this moment carries the old details, so it must not refresh them back.
    .addColumn("profile_updated_at", "timestamptz")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("account")
    .dropColumn("first_name")
    .dropColumn("last_name")
    .dropColumn("profile_updated_at")
    .execute();
}
