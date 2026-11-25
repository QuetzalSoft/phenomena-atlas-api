import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/libs/db/database.js";
import { TransactionManager } from "../src/libs/db/transaction-manager.js";
import { PhenomenonIndexCalculator, phenomenonIndexLockSpace } from "../src/modules/phenomenon/database/phenomenon-index.calculator.js";
import type { Characteristic } from "../src/modules/phenomenon/domain/characteristic.js";
import type { WeightingExpression } from "../src/modules/phenomenon/domain/weighting-expression.js";
import { createIsolatedDatabase } from "./support/database.js";

/** A square of about a kilometre, as a MultiPolygon in WKT. */
const square = (west: number, south: number, width = 0.01) =>
  `MULTIPOLYGON(((${west} ${south}, ${west + width} ${south}, ${west + width} ${south + 0.01}, ${west} ${south + 0.01}, ${west} ${south})))`;

/**
 * Version 1 has Centro (1, population 100), Norte (2, 50, north of Centro), Vacío (3, 0, east
 * of Centro) and Oeste (4, 20, west of Centro). The partition rules are the region module's
 * business, so the rows are written directly.
 */
async function seedPartition(db: Kysely<Database>): Promise<void> {
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

const victims: Characteristic = { type: "number", key: "victims", label: "Victims", required: true, retired: false, integer: true };
const count: WeightingExpression = { kind: "aggregate", function: "count" };
const of = (fn: "sum" | "mean", key: string): WeightingExpression => ({ kind: "aggregate", function: fn, characteristicKey: key });

describe("computing a phenomenon's index", () => {
  let db: Kysely<Database>;
  // A second pool, so that a second connection can watch or block the first.
  let other: Kysely<Database>;
  let transactions: TransactionManager;
  let calculator: PhenomenonIndexCalculator;
  let author: string;

  beforeAll(async () => {
    const databaseUrl = await createIsolatedDatabase("phenomenon_index");
    db = createDatabase(databaseUrl);
    other = createDatabase(databaseUrl);
    transactions = new TransactionManager(db);
    calculator = new PhenomenonIndexCalculator(transactions);
    await seedPartition(db);
    ({ id: author } = await db.insertInto("account").values({ subject: "index-author" }).returning("id").executeTakeFirstOrThrow());
  });

  afterAll(async () => {
    await other.destroy();
    await db.destroy();
  });

  /** A phenomenon written directly, as the phenomenon module's rules are tested elsewhere. */
  const phenomenon = async (
    weightingFunction: WeightingExpression,
    { status = "published", revision = 2 }: { status?: "draft" | "published" | "archived"; revision?: number } = {},
  ): Promise<number> => {
    const row = await db
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
    return row.id;
  };

  /** Files reports directly: one per entry, in that region, with those values. */
  const file = async (phenomenonId: number, reports: [regionId: number, values: Record<string, unknown>][], into = db) => {
    await into
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
  };

  /** The stored index, by region id. */
  const indexOf = async (phenomenonId: number, from = db) => {
    const rows = await from
      .selectFrom("phenomenon_index")
      .select(["region_id", "value"])
      .where("phenomenon_id", "=", phenomenonId)
      .orderBy("region_id")
      .execute();
    return Object.fromEntries(rows.map((row) => [row.region_id, row.value]));
  };

  const computationOf = (phenomenonId: number) =>
    db.selectFrom("phenomenon_index_computation").selectAll().where("phenomenon_id", "=", phenomenonId).executeTakeFirst();

  it("gives every current region a row: count and sum are 0 where there are no reports, the mean is NULL", async () => {
    const counted = await phenomenon(count);
    const summed = await phenomenon(of("sum", "victims"));
    const averaged = await phenomenon(of("mean", "victims"));
    for (const id of [counted, summed, averaged]) {
      await file(id, [
        [1, { victims: 2 }],
        [1, { victims: 3 }],
      ]);
      expect(await calculator.recompute(id, { wait: true })).toBe("computed");
    }

    expect(await indexOf(counted)).toEqual({ 1: 2, 2: 0, 3: 0, 4: 0 });
    expect(await indexOf(summed)).toEqual({ 1: 5, 2: 0, 3: 0, 4: 0 });
    expect(await indexOf(averaged)).toEqual({ 1: 2.5, 2: null, 3: null, 4: null });
  });

  it("gives no index where the function divides by a population of 0", async () => {
    const id = await phenomenon({ kind: "operation", operator: "divide", left: count, right: { kind: "population" } });
    await file(id, [
      [1, {}],
      [1, {}],
      [3, {}],
    ]);

    await calculator.recompute(id, { wait: true });

    expect(await indexOf(id)).toEqual({ 1: 0.02, 2: 0, 3: null, 4: 0 });
  });

  it("records when the computation started, and the revision and partition version it used", async () => {
    const id = await phenomenon(count, { revision: 7 });

    const startedAt = await transactions.run(async () => {
      const { rows } = await sql<{ now: Date }>`SELECT now()`.execute(transactions.connection);
      await calculator.recompute(id, { wait: true });
      return rows[0]?.now;
    });

    expect(await computationOf(id)).toEqual({ phenomenon_id: id, computed_at: startedAt, phenomenon_revision: 7, partition_version: 1 });
  });

  it("replaces the previous values when it computes again", async () => {
    const id = await phenomenon(count);
    await file(id, [[1, {}]]);
    await calculator.recompute(id, { wait: true });
    await file(id, [[2, {}]]);

    await calculator.recompute(id, { wait: true });

    expect(await indexOf(id)).toEqual({ 1: 1, 2: 1, 3: 0, 4: 0 });
    // One row per current region: nothing left over from the first computation.
    const { rows } = await db
      .selectFrom("phenomenon_index")
      .select((eb) => eb.fn.countAll<string>().as("rows"))
      .where("phenomenon_id", "=", id)
      .executeTakeFirstOrThrow();
    expect(rows).toBe("4");
  });

  it("leaves a draft or an archived phenomenon alone", async () => {
    for (const status of ["draft", "archived"] as const) {
      const id = await phenomenon(count, { status });
      await file(id, [[1, {}]]);

      expect(await calculator.recompute(id, { wait: true })).toBe("skipped");

      expect(await computationOf(id)).toBeUndefined();
      expect(await indexOf(id)).toEqual({});
    }
  });

  it("gives up without writing when told not to wait and another connection holds the phenomenon's lock", async () => {
    const id = await phenomenon(count);
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = other.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(${phenomenonIndexLockSpace}::integer, ${id}::integer)`.execute(transaction);
      locked();
      await released;
    });

    try {
      await isLocked;
      expect(await calculator.recompute(id, { wait: false })).toBe("skipped");
      expect(await computationOf(id)).toBeUndefined();
      expect(await indexOf(id)).toEqual({});
    } finally {
      release();
      await holder;
    }
    expect(await calculator.recompute(id, { wait: false })).toBe("computed");
  });

  it("lets other connections see the previous values, complete, until the new computation commits", async () => {
    const id = await phenomenon(count);
    await file(id, [[1, {}]]);
    await calculator.recompute(id, { wait: true });
    const previous = { 1: 1, 2: 0, 3: 0, 4: 0 };

    await transactions.run(async () => {
      await file(id, [[2, {}]], transactions.connection);
      await calculator.recompute(id, { wait: true });
      expect(await indexOf(id, transactions.connection)).toEqual({ 1: 1, 2: 1, 3: 0, 4: 0 });

      expect(await indexOf(id, other)).toEqual(previous);
    });

    expect(await indexOf(id, other)).toEqual({ 1: 1, 2: 1, 3: 0, 4: 0 });
  });

  it("keeps the previous computation when the new one fails part way", async () => {
    const id = await phenomenon(of("sum", "victims"));
    await file(id, [[1, { victims: 4 }]]);
    await calculator.recompute(id, { wait: true });
    const previous = await computationOf(id);

    // A value the database cannot read as a number makes the INSERT fail, after the old
    // values were deleted and the computation row was rewritten.
    await file(id, [[1, { victims: "many" }]]);
    await expect(calculator.recompute(id, { wait: true })).rejects.toThrow(/double precision/);

    expect(await indexOf(id)).toEqual({ 1: 4, 2: 0, 3: 0, 4: 0 });
    expect(await computationOf(id)).toEqual(previous);
  });

  // Last: it changes the partition every test above computes over.
  it("counts the reports of a merged region in the region that absorbed it, and drops the retired region", async () => {
    const id = await phenomenon(count);
    await file(id, [
      [1, {}],
      [1, {}],
      [4, {}],
      [4, {}],
      [4, {}],
    ]);
    await calculator.recompute(id, { wait: true });
    expect(await indexOf(id)).toEqual({ 1: 2, 2: 0, 3: 0, 4: 3 });

    // Version 2 merges Oeste into Centro: Centro grows west over Oeste's last shape, and
    // Norte only touches that shape at a corner.
    await db.transaction().execute(async (transaction) => {
      await sql`INSERT INTO partition_version (number) VALUES (2)`.execute(transaction);
      await sql`UPDATE region SET retired_in = 2 WHERE id = 4`.execute(transaction);
      await sql`UPDATE region_state SET valid_to = 2 WHERE region_id IN (1, 4) AND valid_to IS NULL`.execute(transaction);
      await sql`
        INSERT INTO region_state (region_id, valid_from, name, population, geometry)
        VALUES (1, 2, 'Centro', 120, ST_GeomFromText(${square(-103.41, 20.6, 0.02)}, 4326))
      `.execute(transaction);
    });

    await calculator.recompute(id, { wait: true });

    expect(await indexOf(id)).toEqual({ 1: 5, 2: 0, 3: 0 });
    expect(await computationOf(id)).toMatchObject({ partition_version: 2 });
  });
});

describe("computing a phenomenon's index before any partition exists", () => {
  let db: Kysely<Database>;

  beforeAll(async () => {
    db = createDatabase(await createIsolatedDatabase("phenomenon_index_without_partition"));
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("leaves a published phenomenon without a computation, so that it is due once a partition exists", async () => {
    const { id } = await db
      .insertInto("phenomenon")
      .values({
        name: "Gender violence",
        description: "",
        status: "published",
        characteristics: JSON.stringify([]),
        weighting_function: JSON.stringify(count),
        revision: 2,
        refresh_interval_minutes: 60,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    expect(await new PhenomenonIndexCalculator(new TransactionManager(db)).recompute(id, { wait: true })).toBe("skipped");

    expect(await db.selectFrom("phenomenon_index_computation").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("phenomenon_index").selectAll().execute()).toEqual([]);
  });
});
