import { Logger } from "@nestjs/common";
import { loadDatabaseUrl } from "./configs/app.config.js";
import { createDatabase } from "./libs/db/database.js";
import {
  clearSourceCache,
  fetchInitialPartitionSources,
} from "./modules/region/commands/load-initial-partition/initial-partition.sources.js";
import {
  loadInitialPartition,
  PartitionAlreadyLoadedError,
} from "./modules/region/commands/load-initial-partition/load-initial-partition.js";

// Loads the municipalities and version 1 of the region partition from INEGI and IMEPLAN:
// `load-regions [--refresh]`. Downloads are cached in .cache/region-sources; --refresh
// fetches them again. See docs/adr/0010-region-data-sources.md in the system repository.
const logger = new Logger("Regions");
const cacheDirectory = ".cache/region-sources";
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--refresh")) {
  logger.error("Usage: load-regions [--refresh]");
  process.exit(1);
}

if (args.includes("--refresh")) {
  await clearSourceCache(cacheDirectory);
}
const sources = await fetchInitialPartitionSources(cacheDirectory, undefined, (message) => logger.log(message));
const db = createDatabase(loadDatabaseUrl());
try {
  const summary = await loadInitialPartition(db, sources, (message) => logger.log(message));
  for (const municipality of summary.municipalities) {
    logger.log(
      `${municipality.name} (${municipality.code}): ${municipality.colonias} colonias` +
        `${municipality.remainder ? " and one region outside colonias" : ""}, ` +
        `population ${municipality.population.toLocaleString("en")} of ${municipality.censusPopulation?.toLocaleString("en") ?? "?"} in the census.`,
    );
  }
  logger.log(
    `${summary.coloniasDropped} colonias dropped, ${summary.coloniasReassigned} placed in another municipality than IMEPLAN says, ` +
      `${summary.suppressedBlocks} blocks with suppressed population counted as 0.`,
  );
} catch (error) {
  // An expected refusal, not a failure: say what is wrong without a stack trace.
  if (!(error instanceof PartitionAlreadyLoadedError)) {
    throw error;
  }
  logger.error(error.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
