import { Logger } from "@nestjs/common";
import type { MigrationResultSet } from "kysely/migration";
import { loadDatabaseUrl } from "./configs/app.config.js";
import { createDatabase } from "./libs/db/database.js";
import { createMigrator, throwIfFailed } from "./libs/db/migrator.js";

// Applies every pending migration. With `down`, reverts the last one applied instead.
const direction = process.argv[2] ?? "latest";
if (direction !== "latest" && direction !== "down") {
  throw new Error(`Unknown direction "${direction}". Use "latest" or "down".`);
}

const logger = new Logger("Migrations");
const db = createDatabase(loadDatabaseUrl());
let resultSet: MigrationResultSet;
try {
  const migrator = createMigrator(db);
  resultSet = direction === "down" ? await migrator.migrateDown() : await migrator.migrateToLatest();
} finally {
  await db.destroy();
}

for (const result of resultSet.results ?? []) {
  logger.log(`${result.direction} ${result.migrationName}: ${result.status}`);
}
throwIfFailed(resultSet);
if (!resultSet.results?.length) {
  logger.log("Nothing to migrate.");
}
