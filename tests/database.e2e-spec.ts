import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "../src/libs/db/database.js";
import { createMigrator } from "../src/libs/db/migrator.js";

describe("database", () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createDatabase(inject("databaseUrl"));
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("has every migration applied", async () => {
    const migrations = await createMigrator(db).getMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.filter((migration) => !migration.executedAt)).toEqual([]);
  });

  it("returns geometries as GeoJSON, longitude first", async () => {
    const { rows } = await sql<{ geometry: unknown }>`
      SELECT ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(-99.1332, 19.4326), 4326))::json AS geometry
    `.execute(db);

    expect(rows[0]?.geometry).toEqual({ type: "Point", coordinates: [-99.1332, 19.4326] });
  });
});
