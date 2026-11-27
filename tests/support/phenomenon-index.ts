import { type Kysely, sql } from "kysely";
import type { Database } from "../../src/libs/db/database.js";
import type { Characteristic } from "../../src/modules/phenomenon/domain/characteristic.js";
import type { WeightingExpression } from "../../src/modules/phenomenon/domain/weighting-expression.js";

// Rows written directly for the specs of the phenomenon index. The partition, phenomenon and
// report rules belong to their modules and are tested there.

/** A square of about a kilometre, as a MultiPolygon in WKT. */
export const square = (west: number, south: number, width = 0.01) =>
  `MULTIPOLYGON(((${west} ${south}, ${west + width} ${south}, ${west + width} ${south + 0.01}, ${west} ${south + 0.01}, ${west} ${south})))`;

/**
 * Version 1 has Centro (1, population 100), Norte (2, 50, north of Centro), Vacío (3, 0, east
 * of Centro) and Oeste (4, 20, west of Centro).
 */
export async function seedPartition(db: Kysely<Database>): Promise<void> {
  await sql`INSERT INTO municipality (code, name, geometry) VALUES ('14039', 'Guadalajara', ST_GeomFromText(${square(-103.42, 20.6, 0.04)}, 4326))`.execute(db);
  await sql`INSERT INTO partition_version (number) VALUES (1)`.execute(db);
  await sql`INSERT INTO region (municipality_code, created_in) VALUES ('14039', 1), ('14039', 1), ('14039', 1), ('14039', 1)`.execute(db);
  await sql`
    INSERT INTO region_state (region_id, valid_from, name, population, geometry) VALUES
      (1, 1, 'Centro', 100, ST_GeomFromText(${square(-103.4, 20.6)}, 4326)),
      (2, 1, 'Norte', 50, ST_GeomFromText(${square(-103.4, 20.61)}, 4326)),
      (3, 1, 'Vacío', 0, ST_GeomFromText(${square(-103.39, 20.6)}, 4326)),
      (4, 1, 'Oeste', 20, ST_GeomFromText(${square(-103.41, 20.6)}, 4326))
  `.execute(db);
}

/** An account to author reports, by its id. */
export async function createAuthor(db: Kysely<Database>, subject = "index-author"): Promise<string> {
  const { id } = await db.insertInto("account").values({ subject }).returning("id").executeTakeFirstOrThrow();
  return id;
}

export const victims: Characteristic = { type: "number", key: "victims", label: "Victims", required: true, retired: false, integer: true };
export const count: WeightingExpression = { kind: "aggregate", function: "count" };
export const of = (fn: "sum" | "mean", key: string): WeightingExpression => ({ kind: "aggregate", function: fn, characteristicKey: key });

/** A phenomenon whose only characteristic is `victims`, by its id. */
export async function insertPhenomenon(
  db: Kysely<Database>,
  weightingFunction: WeightingExpression,
  { status = "published", revision = 2 }: { status?: "draft" | "published" | "archived"; revision?: number } = {},
): Promise<number> {
  const { id } = await db
    .insertInto("phenomenon")
    .values({
      name: "Gender violence",
      description: "",
      status,
      characteristics: JSON.stringify([victims]),
      weighting_function: JSON.stringify(weightingFunction),
      revision,
      refresh_interval_minutes: 60,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return id;
}

/** One report per entry, in that region, with those values. */
export async function fileReports(
  db: Kysely<Database>,
  author: string,
  phenomenonId: number,
  reports: [regionId: number, values: Record<string, unknown>][],
): Promise<void> {
  await db
    .insertInto("incident_report")
    .values(
      reports.map(([regionId, values]) => ({
        phenomenon_id: phenomenonId,
        region_id: regionId,
        author_account_id: author,
        occurred_on: "2026-11-01",
        characteristic_values: JSON.stringify(values),
      })),
    )
    .execute();
}

/** The stored index, by region id. */
export async function indexOf(db: Kysely<Database>, phenomenonId: number): Promise<Record<number, number | null>> {
  const rows = await db
    .selectFrom("phenomenon_index")
    .select(["region_id", "value"])
    .where("phenomenon_id", "=", phenomenonId)
    .orderBy("region_id")
    .execute();
  return Object.fromEntries(rows.map((row) => [row.region_id, row.value]));
}

export function computationOf(db: Kysely<Database>, phenomenonId: number) {
  return db.selectFrom("phenomenon_index_computation").selectAll().where("phenomenon_id", "=", phenomenonId).executeTakeFirst();
}
