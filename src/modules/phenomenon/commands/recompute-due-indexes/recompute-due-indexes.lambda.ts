import { Logger } from "@nestjs/common";
import type { Kysely } from "kysely";
import type { Database } from "../../../../libs/db/database.js";
import { TransactionManager } from "../../../../libs/db/transaction-manager.js";
import { PhenomenonIndexCalculator } from "../../database/phenomenon-index.calculator.js";
import { recomputeDueIndexes, type TickLogger, type TickSummary } from "./recompute-due-indexes.js";

/** The one part of the Lambda context the tick uses, so that no AWS package is needed. */
export interface LambdaContext {
  getRemainingTimeInMillis(): number;
}

/** How long before the Lambda's timeout a tick starts no new computation, by default. */
export const defaultMarginSeconds = 60;

/** `INDEX_TICK_MARGIN_SECONDS`, or the default when it is not set. */
export function loadMarginSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INDEX_TICK_MARGIN_SECONDS;
  if (raw === undefined || raw === "") {
    return defaultMarginSeconds;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`INDEX_TICK_MARGIN_SECONDS must be a number of seconds, not ${raw}.`);
  }
  return seconds;
}

/**
 * The Lambda handler, over a database the caller keeps between invocations. Each invocation is
 * one tick, which starts no computation in the last `marginSeconds` before the timeout: the
 * computation under way has that long to finish, and the rest stays due for the next tick.
 * See ADR 0017 in the system repository.
 */
export function createHandler(
  db: Kysely<Database>,
  { marginSeconds = defaultMarginSeconds, logger = new Logger("Index") }: { marginSeconds?: number; logger?: TickLogger } = {},
): (event: unknown, context: LambdaContext) => Promise<TickSummary> {
  const calculator = new PhenomenonIndexCalculator(new TransactionManager(db));
  return (_event, context) =>
    recomputeDueIndexes(calculator, { deadline: Date.now() + context.getRemainingTimeInMillis() - marginSeconds * 1000, logger });
}
