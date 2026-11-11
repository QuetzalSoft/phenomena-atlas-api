import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { TransactionManager } from "../../../libs/db/transaction-manager.js";
import type { MultiPolygon } from "../domain/geometry.js";
import type { PartitionState, PlannedChange, PlannedDraft } from "../domain/partition-change.js";
import {
  InvalidGeometryError,
  type PartitionChangeError,
  PartitionGapError,
  RegionCrossesMunicipalityError,
  RegionOutOfAreaError,
  RegionOverlapError,
} from "../domain/region.errors.js";
import { asGeoJson, grid } from "./geometry.sql.js";
import type { RegionRepositoryPort } from "./region.repository.port.js";

/** Overlaps and gaps smaller than this, in square metres, are floating-point noise. */
export const areaTolerance = 1;

/** Any number: only needs to be the same for every save, so saves queue behind each other. */
const partitionLockKey = 4_203_311;

@Injectable()
export class RegionRepository implements RegionRepositoryPort {
  constructor(private readonly transactions: TransactionManager) {}

  private get db() {
    return this.transactions.connection;
  }

  async lockPartition(): Promise<PartitionState | undefined> {
    await sql`SELECT pg_advisory_xact_lock(${partitionLockKey})`.execute(this.db);
    const latest = await this.db
      .selectFrom("partition_version")
      .select((eb) => eb.fn.max("number").as("number"))
      .executeTakeFirst();
    if (latest?.number == null) {
      return undefined;
    }
    const [regions, municipalities] = await Promise.all([
      this.db.selectFrom("region").select(["id", "municipality_code"]).where("retired_in", "is", null).execute(),
      this.db.selectFrom("municipality").select("code").execute(),
    ]);
    return {
      latestVersion: latest.number,
      regions: new Map(regions.map((region) => [region.id, { municipalityCode: region.municipality_code }])),
      municipalityCodes: new Set(municipalities.map((municipality) => municipality.code)),
    };
  }

  async apply(change: PlannedChange, authorAccountId: string): Promise<number[]> {
    const { version } = change;
    await this.db.insertInto("partition_version").values({ number: version, author_account_id: authorAccountId }).execute();

    const closed = [...change.changed.map((draft) => draft.id), ...change.retired];
    if (closed.length > 0) {
      await this.db
        .updateTable("region_state")
        .set({ valid_to: version })
        .where("region_id", "in", closed)
        .where("valid_to", "is", null)
        .execute();
    }
    if (change.retired.length > 0) {
      await this.db.updateTable("region").set({ retired_in: version }).where("id", "in", change.retired).execute();
    }

    const createdIds: number[] = [];
    for (const draft of change.created) {
      const { id } = await this.db
        .insertInto("region")
        .values({ municipality_code: draft.municipalityCode, created_in: version })
        .returning("id")
        .executeTakeFirstOrThrow();
      createdIds.push(id);
      await this.insertState(id, version, draft);
    }
    for (const draft of change.changed) {
      await this.insertState(draft.id, version, draft);
    }
    return createdIds;
  }

  private async insertState(regionId: number, version: number, draft: PlannedDraft): Promise<void> {
    await this.db
      .insertInto("region_state")
      .values({
        region_id: regionId,
        valid_from: version,
        name: draft.name,
        population: draft.population,
        geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(draft.geometry)}), 4326)`,
      })
      .execute();
  }

  async findBrokenRule(version: number): Promise<PartitionChangeError | undefined> {
    const invalid = await this.findInvalidGeometry(version);
    if (invalid) {
      return invalid;
    }
    // Valid geometries move onto the grid every stored geometry lives on. Snapping first
    // would quietly repair an invalid one instead of refusing it.
    await sql`
      UPDATE region_state SET geometry = ST_Multi(ST_CollectionExtract(ST_ReducePrecision(geometry, ${grid}), 3))
      WHERE valid_from = ${version}
    `.execute(this.db);
    return (
      (await this.findInvalidGeometry(version)) ??
      (await this.findRegionOutsideItsMunicipality(version)) ??
      (await this.findOverlap(version)) ??
      (await this.findGap(version))
    );
  }

  private async findInvalidGeometry(version: number): Promise<PartitionChangeError | undefined> {
    const { rows } = await sql<{ region_id: number }>`
      SELECT region_id FROM region_state
      WHERE valid_from = ${version} AND (ST_IsEmpty(geometry) OR NOT ST_IsValid(geometry))
      ORDER BY region_id
    `.execute(this.db);
    return rows.length > 0 ? new InvalidGeometryError({ regionIds: rows.map((row) => row.region_id) }) : undefined;
  }

  private async findRegionOutsideItsMunicipality(version: number): Promise<PartitionChangeError | undefined> {
    const { rows } = await sql<{ region_id: number; outside: MultiPolygon; crosses: boolean }>`
      SELECT s.region_id, ${asGeoJson(sql`x.outside`)} AS outside,
             EXISTS (
               SELECT 1 FROM municipality other
               WHERE other.code <> r.municipality_code AND other.geometry && x.outside
                 AND ST_Area(ST_Intersection(other.geometry, x.outside, ${grid})::geography) > ${areaTolerance}
             ) AS crosses
      FROM region_state s
      JOIN region r ON r.id = s.region_id
      JOIN municipality m ON m.code = r.municipality_code
      CROSS JOIN LATERAL (SELECT ST_Difference(s.geometry, m.geometry, ${grid}) AS outside) x
      WHERE s.valid_from = ${version} AND ST_Area(x.outside::geography) > ${areaTolerance}
      ORDER BY s.region_id
      LIMIT 1
    `.execute(this.db);
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    const details = { regionIds: [row.region_id], geometry: row.outside };
    return row.crosses ? new RegionCrossesMunicipalityError(details) : new RegionOutOfAreaError(details);
  }

  private async findOverlap(version: number): Promise<PartitionChangeError | undefined> {
    const { rows } = await sql<{ changed: number; other: number; overlap: MultiPolygon }>`
      SELECT c.region_id AS changed, o.region_id AS other, ${asGeoJson(sql`x.overlap`)} AS overlap
      FROM region_state c
      JOIN region_state o
        ON o.valid_to IS NULL AND o.region_id <> c.region_id
       AND o.geometry && c.geometry AND ST_Intersects(o.geometry, c.geometry)
      CROSS JOIN LATERAL (SELECT ST_Intersection(c.geometry, o.geometry, ${grid}) AS overlap) x
      WHERE c.valid_from = ${version} AND ST_Area(x.overlap::geography) > ${areaTolerance}
      ORDER BY c.region_id, o.region_id
      LIMIT 1
    `.execute(this.db);
    const row = rows[0];
    return row && new RegionOverlapError({ regionIds: [row.changed, row.other], geometry: row.overlap });
  }

  /**
   * The previous version had no gap, so a gap can only open where a changed or retired
   * region used to be. Checking that area alone is exact and much cheaper than the whole map.
   */
  private async findGap(version: number): Promise<PartitionChangeError | undefined> {
    const { rows } = await sql<{ gap: MultiPolygon; region_ids: number[] }>`
      WITH previous AS (
        SELECT ST_Union(geometry, ${grid}) AS area FROM region_state WHERE valid_to = ${version}
      ),
      covered AS (
        SELECT ST_Union(s.geometry, ${grid}) AS area
        FROM region_state s, previous
        WHERE s.valid_to IS NULL AND s.geometry && previous.area AND ST_Intersects(s.geometry, previous.area)
      ),
      gap AS (
        SELECT ST_Difference(previous.area, COALESCE(covered.area, ST_GeomFromText('POLYGON EMPTY', 4326)), ${grid}) AS area
        FROM previous, covered
        WHERE previous.area IS NOT NULL
      )
      SELECT ${asGeoJson(sql`gap.area`)} AS gap,
             ARRAY(
               SELECT s.region_id FROM region_state s
               WHERE s.valid_to = ${version} AND ST_Intersects(s.geometry, gap.area)
               ORDER BY s.region_id
             ) AS region_ids
      FROM gap
      WHERE ST_Area(gap.area::geography) > ${areaTolerance}
    `.execute(this.db);
    const row = rows[0];
    return row && new PartitionGapError({ regionIds: row.region_ids, geometry: row.gap });
  }

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.transactions.run(work);
  }
}
