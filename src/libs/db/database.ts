import { Logger } from "@nestjs/common";
import { type ColumnType, type Generated, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

/**
 * Every table the API reads or writes, keyed by table name. A module adds its tables here,
 * written by hand to match the migration that creates them.
 */
export interface Database {
  account: AccountTable;
  municipality: MunicipalityTable;
  partition_version: PartitionVersionTable;
  region: RegionTable;
  region_state: RegionStateTable;
}

/**
 * A PostGIS geometry column. Reads go through ST_AsGeoJSON and writes through
 * ST_GeomFromGeoJSON in the `sql` template, so the raw column is never selected.
 */
export type GeometryColumn = ColumnType<never, unknown, unknown>;

/** See database/migrations/20261111210000_create_region_partition.ts. */
export interface MunicipalityTable {
  code: string;
  name: string;
  geometry: GeometryColumn;
}

export interface PartitionVersionTable {
  number: number;
  created_at: ColumnType<Date, never, never>;
  author_account_id: string | null;
}

export interface RegionTable {
  id: ColumnType<number, never, never>;
  municipality_code: string;
  created_in: number;
  retired_in: number | null;
}

export interface RegionStateTable {
  region_id: number;
  valid_from: number;
  valid_to: number | null;
  name: string;
  population: number;
  geometry: GeometryColumn;
}

/** See database/migrations/20261111190000_create_account.ts. */
export interface AccountTable {
  id: Generated<string>;
  subject: string;
  username: string | null;
  name: string | null;
  email: string | null;
  role: ColumnType<"user" | "analyst" | "admin", "user" | "analyst" | "admin" | undefined>;
  created_at: ColumnType<Date, never, never>;
}

/** Injection token for the `Kysely<Database>` instance. */
export const DATABASE = Symbol("DATABASE");

const logger = new Logger("Database");

export function createDatabase(url: string): Kysely<Database> {
  const pool = new Pool({ connectionString: url });
  // An idle client that loses its connection emits an error on the pool, and an unhandled
  // error event ends the process. The pool discards that client and opens a new one when needed.
  pool.on("error", (error) => {
    logger.error(`Idle database client failed: ${error.message}`);
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
