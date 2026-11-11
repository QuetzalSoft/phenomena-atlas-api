import { type Kysely, sql } from "kysely";

// The municipalities of the metropolitan area and its versioned region partition.
// See docs/adr/0010 and docs/adr/0011 in the system repository.
export async function up(db: Kysely<unknown>): Promise<void> {
  // Reference data, loaded with the initial partition and never edited through the API.
  await db.schema
    .createTable("municipality")
    // The five-digit INEGI key, such as 14039.
    .addColumn("code", "text", (column) => column.primaryKey().check(sql`code ~ '^[0-9]{5}$'`))
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("geometry", sql`geometry(MultiPolygon, 4326)`, (column) => column.notNull())
    .execute();
  await db.schema.createIndex("municipality_geometry_idx").on("municipality").using("gist").column("geometry").execute();

  await db.schema
    .createTable("partition_version")
    .addColumn("number", "integer", (column) => column.primaryKey().check(sql`number >= 1`))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    // Null only for version 1, the initial load, which no account saved.
    .addColumn("author_account_id", "uuid", (column) => column.references("account.id"))
    .execute();

  // A region's identity. Its name, population and shape live in region_state, one row per
  // version range, so a past version is a query rather than a replay.
  await db.schema
    .createTable("region")
    // An identity column: values come from a sequence, so an id is never handed out twice,
    // not even after a rolled-back save.
    .addColumn("id", "integer", (column) => column.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("municipality_code", "text", (column) => column.notNull().references("municipality.code"))
    .addColumn("created_in", "integer", (column) => column.notNull().references("partition_version.number"))
    .addColumn("retired_in", "integer", (column) => column.references("partition_version.number"))
    .addCheckConstraint("region_retired_after_created", sql`retired_in IS NULL OR retired_in > created_in`)
    .execute();

  await db.schema
    .createTable("region_state")
    .addColumn("region_id", "integer", (column) => column.notNull().references("region.id"))
    // The state holds from valid_from up to, but not including, valid_to.
    .addColumn("valid_from", "integer", (column) => column.notNull().references("partition_version.number"))
    .addColumn("valid_to", "integer", (column) => column.references("partition_version.number"))
    .addColumn("name", "text", (column) => column.notNull().check(sql`char_length(name) BETWEEN 1 AND 200`))
    .addColumn("population", "integer", (column) => column.notNull().check(sql`population >= 0`))
    .addColumn("geometry", sql`geometry(MultiPolygon, 4326)`, (column) => column.notNull())
    .addPrimaryKeyConstraint("region_state_pkey", ["region_id", "valid_from"])
    .addCheckConstraint("region_state_range", sql`valid_to IS NULL OR valid_to > valid_from`)
    .execute();
  // At most one current state per region.
  await db.schema
    .createIndex("region_state_current_idx")
    .on("region_state")
    .column("region_id")
    .unique()
    .where(sql.ref("valid_to"), "is", null)
    .execute();
  await db.schema.createIndex("region_state_geometry_idx").on("region_state").using("gist").column("geometry").execute();
  await db.schema.createIndex("region_state_valid_from_idx").on("region_state").column("valid_from").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("region_state").execute();
  await db.schema.dropTable("region").execute();
  await db.schema.dropTable("partition_version").execute();
  await db.schema.dropTable("municipality").execute();
}
