import { type Kysely, sql } from "kysely";

// Incident reports. See docs/adr/0013-incident-reports.md in the system repository: a report
// records a region and a day, never a point or a time.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("incident_report")
    // An identity never hands out the same id twice, even after a removal.
    .addColumn("id", "integer", (column) => column.primaryKey().generatedAlwaysAsIdentity())
    // Only a draft phenomenon can be deleted, and a draft has no reports.
    .addColumn("phenomenon_id", "integer", (column) => column.notNull().references("phenomenon.id"))
    // Region ids are never reused, so a report keeps its region even once a version retires it.
    .addColumn("region_id", "integer", (column) => column.notNull().references("region.id"))
    .addColumn("author_account_id", "uuid", (column) => column.notNull().references("account.id"))
    .addColumn("occurred_on", "date", (column) => column.notNull())
    // Optional (ADR 0013): free text is where a reporter is most likely to identify someone.
    .addColumn("description", "text", (column) => column.check(sql`char_length(description) BETWEEN 1 AND 2000`))
    // One value per characteristic, keyed by its key. The API checks them against the
    // phenomenon's definition on filing (ADR 0012); the database cannot.
    .addColumn("characteristic_values", "jsonb", (column) => column.notNull().check(sql`jsonb_typeof(characteristic_values) = 'object'`))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  // Both listings run newest first, page by page.
  await db.schema
    .createIndex("incident_report_phenomenon_idx")
    .on("incident_report")
    .expression(sql`phenomenon_id, created_at DESC, id DESC`)
    .execute();
  await db.schema
    .createIndex("incident_report_author_idx")
    .on("incident_report")
    .expression(sql`author_account_id, created_at DESC, id DESC`)
    .execute();
  // The index of a phenomenon groups its reports by region.
  await db.schema.createIndex("incident_report_region_idx").on("incident_report").columns(["region_id", "phenomenon_id"]).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("incident_report").execute();
}
