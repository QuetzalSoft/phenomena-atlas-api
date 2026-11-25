import { type Kysely, sql } from "kysely";

// The stored phenomenon index. See docs/adr/0016-phenomenon-index-computation.md in the system
// repository: only the last computation of each phenomenon is kept, replaced whole in one
// transaction, so readers never see a mix of two computations.
//
// No ON DELETE CASCADE: only a draft can be deleted, and a draft is never computed.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("phenomenon_index_computation")
    // One row per phenomenon: its last computation.
    .addColumn("phenomenon_id", "integer", (column) => column.primaryKey().references("phenomenon.id"))
    // When the computation started: now() of its transaction, so the cadence does not drift
    // by the length of a run.
    .addColumn("computed_at", "timestamptz", (column) => column.notNull())
    // What it was computed from. A change to either makes the phenomenon due again.
    .addColumn("phenomenon_revision", "integer", (column) => column.notNull().check(sql`phenomenon_revision >= 1`))
    .addColumn("partition_version", "integer", (column) => column.notNull().references("partition_version.number"))
    .execute();

  await db.schema
    .createTable("phenomenon_index")
    // No values without the computation that produced them.
    .addColumn("phenomenon_id", "integer", (column) =>
      column.notNull().references("phenomenon_index_computation.phenomenon_id"),
    )
    .addColumn("region_id", "integer", (column) => column.notNull().references("region.id"))
    // NULL: the function is undefined for the region, which has no index. Not the same as 0.
    .addColumn("value", "double precision")
    .addPrimaryKeyConstraint("phenomenon_index_pkey", ["phenomenon_id", "region_id"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("phenomenon_index").execute();
  await db.schema.dropTable("phenomenon_index_computation").execute();
}
