import { Logger } from "@nestjs/common";
import { loadDatabaseUrl } from "./configs/app.config.js";
import { createDatabase } from "./libs/db/database.js";
import { TransactionManager } from "./libs/db/transaction-manager.js";
import { recomputeDueIndexes } from "./modules/phenomenon/commands/recompute-due-indexes/recompute-due-indexes.js";
import { PhenomenonIndexCalculator } from "./modules/phenomenon/database/phenomenon-index.calculator.js";

// Computes the phenomenon indexes that are due, as the scheduled Lambda does (ADR 0017 in the
// system repository): `index:recompute-due` for one tick, `index:recompute-due --every <seconds>`
// to repeat until stopped.
const logger = new Logger("Index");
const args = process.argv.slice(2);
let every: number | undefined;
if (args.length > 0) {
  every = Number(args[1]);
  if (args.length !== 2 || args[0] !== "--every" || !Number.isFinite(every) || every <= 0) {
    logger.error("Usage: index:recompute-due [--every <seconds>]");
    process.exit(1);
  }
}

const db = createDatabase(loadDatabaseUrl());
const calculator = new PhenomenonIndexCalculator(new TransactionManager(db));

// Ctrl+C ends the wait at once, or lets the tick under way finish, and then closes the database.
let stopping = false;
let wake = () => {};
const stop = () => {
  stopping = true;
  wake();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  for (;;) {
    const { computed, skipped, failed } = await recomputeDueIndexes(calculator, { logger });
    if (every === undefined) {
      // One tick from a terminal says what it did even when nothing was due.
      if (computed + skipped + failed === 0) {
        logger.log("No phenomenon index was due.");
      }
      break;
    }
    if (stopping) {
      break;
    }
    const seconds = every;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, seconds * 1000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    if (stopping) {
      break;
    }
  }
} finally {
  await db.destroy();
}
