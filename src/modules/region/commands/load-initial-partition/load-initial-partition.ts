import { type Kysely, sql, type Transaction } from "kysely";
import type { Database } from "../../../../libs/db/database.js";
import { grid } from "../../database/geometry.sql.js";
import { areaTolerance } from "../../database/region.repository.js";
import { imeplanMunicipalityCodes, type InitialPartitionSources } from "./initial-partition.sources.js";

/** Area left uncovered by colonias and smaller than this, in square metres, goes to a neighbouring colonia. */
export const sliverArea = 10_000;


export class PartitionAlreadyLoadedError extends Error {
  constructor() {
    super("A region partition already exists. The initial load only runs on an empty partition.");
  }
}

export interface MunicipalityLoadSummary {
  code: string;
  name: string;
  colonias: number;
  /** Whether a "<municipality> - outside colonias" region was added. */
  remainder: boolean;
  population: number;
  /** The census total for the whole municipality, rural population included. */
  censusPopulation: number | undefined;
}

export interface InitialLoadSummary {
  municipalities: MunicipalityLoadSummary[];
  /** Colonias dropped because they fall outside the four municipalities or other colonias cover them. */
  coloniasDropped: number;
  /** Colonias that lie mostly in a different municipality than IMEPLAN says. */
  coloniasReassigned: number;
  /** Census blocks whose population the census suppressed, counted as 0. */
  suppressedBlocks: number;
}

const batchSize = 1_000;

/**
 * Builds version 1 of the region partition from the sources and stores it, all in one
 * transaction. The steps are those of ADR 0010 in the system repository. Fails, storing
 * nothing, if a partition exists or the result breaks a partition rule.
 */
export async function loadInitialPartition(
  db: Kysely<Database>,
  sources: InitialPartitionSources,
  log: (message: string) => void = () => {},
): Promise<InitialLoadSummary> {
  return db.transaction().execute(async (tx) => {
    const existing = await tx.selectFrom("partition_version").select("number").limit(1).executeTakeFirst();
    if (existing) {
      throw new PartitionAlreadyLoadedError();
    }

    log("Staging the sources.");
    await stage(tx, sources);

    log("Storing the municipalities.");
    await sql`
      INSERT INTO municipality (code, name, geometry)
      SELECT code, name, ST_Multi(ST_CollectionExtract(ST_ReducePrecision(ST_MakeValid(geometry), ${grid}), 3))
      FROM source_municipality
    `.execute(tx);

    log("Fitting the colonias to the municipalities.");
    // Each colonia goes to the municipality it overlaps most, and is clipped to it.
    await sql`
      CREATE TEMP TABLE colonia ON COMMIT DROP AS
      SELECT c.id, c.name, c.imeplan_municipality, m.code AS municipality_code,
             ST_CollectionExtract(ST_Intersection(c.geometry, m.geometry, ${grid}), 3) AS geometry
      FROM source_colonia c
      CROSS JOIN LATERAL (
        SELECT code, geometry FROM municipality m
        WHERE m.geometry && c.geometry AND ST_Intersects(m.geometry, c.geometry)
        ORDER BY ST_Area(ST_Intersection(m.geometry, c.geometry)) DESC, code
        LIMIT 1
      ) m
    `.execute(tx);
    await sql`ALTER TABLE colonia ADD COLUMN area double precision`.execute(tx);
    await sql`UPDATE colonia SET area = ST_Area(geometry)`.execute(tx);
    await sql`CREATE INDEX ON colonia USING gist (geometry)`.execute(tx);

    log("Removing overlaps between colonias.");
    // Where colonias overlap, the smaller keeps the overlap: each loses whatever smaller ones
    // cover. Most neighbours only touch, so only those whose interiors meet are subtracted.
    await sql`
      CREATE TEMP TABLE region_draft ON COMMIT DROP AS
      SELECT c.id, c.name, c.municipality_code,
             ST_CollectionExtract(COALESCE(ST_Difference(c.geometry, smaller.area, ${grid}), c.geometry), 3) AS geometry
      FROM colonia c
      LEFT JOIN LATERAL (
        SELECT ST_Union(o.geometry, ${grid}) AS area FROM colonia o
        WHERE o.municipality_code = c.municipality_code
          AND (o.area, o.id) < (c.area, c.id)
          AND o.geometry && c.geometry AND ST_Relate(o.geometry, c.geometry, '2********')
      ) smaller ON true
    `.execute(tx);
    await sql`CREATE INDEX ON region_draft USING gist (geometry)`.execute(tx);
    await sql`DELETE FROM region_draft WHERE ST_IsEmpty(geometry) OR ST_Area(geometry::geography) <= ${areaTolerance}`.execute(tx);

    log("Covering the area no colonia covers.");
    await sql`
      CREATE TEMP TABLE leftover ON COMMIT DROP AS
      SELECT row_number() OVER () AS id, municipality_code, geometry FROM (
        SELECT m.code AS municipality_code,
               (ST_Dump(ST_CollectionExtract(
                 ST_Difference(m.geometry, COALESCE(covered.area, 'SRID=4326;POLYGON EMPTY'::geometry), ${grid}), 3
               ))).geom AS geometry
        FROM municipality m
        LEFT JOIN LATERAL (SELECT ST_Union(geometry, ${grid}) AS area FROM region_draft WHERE municipality_code = m.code) covered ON true
      ) pieces
    `.execute(tx);
    // A small piece is a sliver between colonias: it joins the colonia it shares the longest border with.
    await sql`
      CREATE TEMP TABLE absorbed ON COMMIT DROP AS
      SELECT DISTINCT ON (l.id) l.id AS leftover_id, d.id AS draft_id
      FROM leftover l
      JOIN region_draft d
        ON d.municipality_code = l.municipality_code AND d.geometry && l.geometry AND ST_Intersects(d.geometry, l.geometry)
      WHERE ST_Area(l.geometry::geography) < ${sliverArea}
      ORDER BY l.id, ST_Length(ST_Intersection(ST_Boundary(l.geometry), d.geometry)) DESC, d.id
    `.execute(tx);
    await sql`
      UPDATE region_draft d
      SET geometry = ST_CollectionExtract(ST_Union(d.geometry, pieces.area, ${grid}), 3)
      FROM (
        SELECT a.draft_id, ST_Union(l.geometry, ${grid}) AS area
        FROM absorbed a JOIN leftover l ON l.id = a.leftover_id
        GROUP BY a.draft_id
      ) pieces
      WHERE pieces.draft_id = d.id
    `.execute(tx);
    // The rest becomes one region per municipality.
    await sql`
      INSERT INTO region_draft (id, name, municipality_code, geometry)
      SELECT -row_number() OVER (ORDER BY m.code), m.name || ' - outside colonias', m.code, rest.area
      FROM municipality m
      JOIN (
        SELECT l.municipality_code, ST_CollectionExtract(ST_Union(l.geometry, ${grid}), 3) AS area
        FROM leftover l
        WHERE NOT EXISTS (SELECT 1 FROM absorbed a WHERE a.leftover_id = l.id)
        GROUP BY l.municipality_code
      ) rest ON rest.municipality_code = m.code
      WHERE ST_Area(rest.area::geography) > ${areaTolerance}
    `.execute(tx);

    log("Adding up the population of each region.");
    // Each block counts once, in the region containing a point inside it.
    await sql`
      CREATE TEMP TABLE region_population ON COMMIT DROP AS
      SELECT region_id, sum(population)::integer AS population FROM (
        SELECT DISTINCT ON (b.key) b.key, d.id AS region_id, COALESCE(b.population, 0) AS population
        FROM source_block b
        JOIN region_draft d ON d.geometry && b.point AND ST_Intersects(d.geometry, b.point)
        ORDER BY b.key, d.id
      ) assigned
      GROUP BY region_id
    `.execute(tx);

    log("Storing version 1.");
    await tx.insertInto("partition_version").values({ number: 1, author_account_id: null }).execute();
    await sql`
      CREATE TEMP TABLE region_id_map ON COMMIT DROP AS
      SELECT draft_id, nextval(pg_get_serial_sequence('region', 'id'))::integer AS region_id
      FROM (SELECT id AS draft_id FROM region_draft ORDER BY municipality_code, name, id) ordered
    `.execute(tx);
    await sql`
      INSERT INTO region (id, municipality_code, created_in)
      OVERRIDING SYSTEM VALUE
      SELECT map.region_id, d.municipality_code, 1
      FROM region_draft d JOIN region_id_map map ON map.draft_id = d.id
    `.execute(tx);
    await sql`
      INSERT INTO region_state (region_id, valid_from, name, population, geometry)
      SELECT map.region_id, 1, left(d.name, 200), COALESCE(p.population, 0), ST_Multi(d.geometry)
      FROM region_draft d
      JOIN region_id_map map ON map.draft_id = d.id
      LEFT JOIN region_population p ON p.region_id = d.id
    `.execute(tx);

    log("Checking the partition.");
    await assertValidPartition(tx);

    return summarize(tx, sources);
  });
}

async function stage(tx: Transaction<Database>, sources: InitialPartitionSources): Promise<void> {
  await sql`CREATE TEMP TABLE source_municipality (code text, name text, geometry geometry) ON COMMIT DROP`.execute(tx);
  await sql`
    CREATE TEMP TABLE source_colonia (id integer, name text, imeplan_municipality integer, geometry geometry) ON COMMIT DROP
  `.execute(tx);
  await sql`CREATE TEMP TABLE source_block (key text PRIMARY KEY, population integer, point geometry) ON COMMIT DROP`.execute(tx);

  const inegi = (json: string) =>
    sql`ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${json}), ${sources.inegiSrid}::integer), 4326)`;

  for (const municipality of sources.municipalities) {
    await sql`
      INSERT INTO source_municipality VALUES (${municipality.code}, ${municipality.name}, ${inegi(JSON.stringify(municipality.geometry))})
    `.execute(tx);
  }

  for (const batch of batches(sources.colonias.map((colonia, index) => ({ ...colonia, id: index + 1 })))) {
    await sql`
      INSERT INTO source_colonia (id, name, imeplan_municipality, geometry)
      SELECT (e->>'id')::integer, e->>'name', (e->>'imeplanMunicipality')::integer,
             ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(e->'geometry'), 4326)), 3)
      FROM jsonb_array_elements(${JSON.stringify(batch)}::jsonb) e
    `.execute(tx);
  }
  await sql`CREATE INDEX ON source_colonia USING gist (geometry)`.execute(tx);

  const blocks = sources.blocks.map((block) => ({
    key: block.key,
    population: sources.blockPopulation.get(block.key) ?? null,
    geometry: block.geometry,
  }));
  for (const batch of batches(blocks)) {
    await sql`
      INSERT INTO source_block (key, population, point)
      SELECT e->>'key', (e->>'population')::integer,
             ST_PointOnSurface(ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(e->'geometry'), ${sources.inegiSrid}::integer), 4326)))
      FROM jsonb_array_elements(${JSON.stringify(batch)}::jsonb) e
      ON CONFLICT (key) DO NOTHING
    `.execute(tx);
  }
  await sql`CREATE INDEX ON source_block USING gist (point)`.execute(tx);
}

function* batches<T>(items: T[]): Generator<T[]> {
  for (let start = 0; start < items.length; start += batchSize) {
    yield items.slice(start, start + batchSize);
  }
}

/** The same rules a save is held to, over the whole partition. Throws, rolling back, if one fails. */
async function assertValidPartition(tx: Transaction<Database>): Promise<void> {
  const { rows } = await sql<{ problem: string }>`
    SELECT 'region ' || s.region_id || ' has an invalid geometry' AS problem
    FROM region_state s WHERE NOT ST_IsValid(s.geometry) OR ST_IsEmpty(s.geometry)
    UNION ALL
    SELECT 'region ' || s.region_id || ' reaches outside municipality ' || r.municipality_code
    FROM region_state s JOIN region r ON r.id = s.region_id JOIN municipality m ON m.code = r.municipality_code
    WHERE ST_Area(ST_Difference(s.geometry, m.geometry, ${grid})::geography) > ${areaTolerance}
    UNION ALL
    SELECT 'regions ' || a.region_id || ' and ' || b.region_id || ' overlap'
    FROM region_state a JOIN region_state b
      ON a.region_id < b.region_id AND a.geometry && b.geometry AND ST_Intersects(a.geometry, b.geometry)
    WHERE ST_Area(ST_Intersection(a.geometry, b.geometry, ${grid})::geography) > ${areaTolerance}
    UNION ALL
    SELECT 'municipality ' || m.code || ' has ' || round(ST_Area(gap.area::geography)) || ' m² without a region'
    FROM municipality m
    CROSS JOIN LATERAL (
      SELECT ST_Difference(m.geometry, ST_Union(s.geometry, ${grid}), ${grid}) AS area
      FROM region_state s JOIN region r ON r.id = s.region_id WHERE r.municipality_code = m.code
    ) gap
    WHERE ST_Area(gap.area::geography) > ${areaTolerance}
  `.execute(tx);
  if (rows.length > 0) {
    throw new Error(`The initial partition breaks the partition rules:\n${rows.map((row) => `- ${row.problem}`).join("\n")}`);
  }
}

async function summarize(tx: Transaction<Database>, sources: InitialPartitionSources): Promise<InitialLoadSummary> {
  const { rows } = await sql<{ code: string; name: string; colonias: number; remainder: boolean; population: number }>`
    SELECT m.code, m.name,
           count(*) FILTER (WHERE d.id > 0)::integer AS colonias,
           bool_or(d.id < 0) AS remainder,
           COALESCE(sum(p.population), 0)::integer AS population
    FROM municipality m
    JOIN region_draft d ON d.municipality_code = m.code
    LEFT JOIN region_population p ON p.region_id = d.id
    GROUP BY m.code, m.name
    ORDER BY m.code
  `.execute(tx);
  const counts = await sql<{ kept: number; reassigned: number }>`
    SELECT (SELECT count(*) FROM region_draft WHERE id > 0)::integer AS kept,
           (SELECT count(*) FROM colonia c
             WHERE c.imeplan_municipality IS DISTINCT FROM (${JSON.stringify(imeplanMunicipalityCodes)}::jsonb ->> c.municipality_code)::integer
           )::integer AS reassigned
  `.execute(tx);
  const { kept = 0, reassigned = 0 } = counts.rows[0] ?? {};
  const suppressed = sources.blocks.filter((block) => sources.blockPopulation.get(block.key) === null).length;
  return {
    municipalities: rows.map((row) => ({ ...row, censusPopulation: sources.municipalityPopulation.get(row.code) })),
    coloniasDropped: sources.colonias.length - kept,
    coloniasReassigned: reassigned,
    suppressedBlocks: suppressed,
  };
}
