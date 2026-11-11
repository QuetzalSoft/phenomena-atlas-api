import { Logger } from "@nestjs/common";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

/**
 * Every table the API reads or writes, keyed by table name. A module adds its tables here,
 * written by hand to match the migration that creates them.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no table exists yet
export interface Database {}

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
