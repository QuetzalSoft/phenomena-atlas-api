import type { PhenomenonIndexCalculatorPort } from "../../database/phenomenon-index.calculator.port.js";

/** Where a tick reports. NestJS's Logger fits. */
export interface TickLogger {
  log(message: string): void;
  error(message: string): void;
}

export interface TickSummary {
  computed: number;
  /** Another computation of the same phenomenon held its lock, or it stopped being due. */
  skipped: number;
  failed: number;
}

/**
 * One tick: computes every phenomenon whose index is due, the most overdue first, one at a
 * time and each in its own transaction. See ADR 0017 in the system repository.
 *
 * A failure is logged and the tick moves on; the phenomenon stays due for the next tick. With
 * a `deadline`, an instant in milliseconds, it starts nothing once it has passed, and the rest
 * stays due for the next tick. Logs a summary only when there was something due.
 */
export async function recomputeDueIndexes(
  calculator: PhenomenonIndexCalculatorPort,
  { deadline, logger }: { deadline?: number; logger: TickLogger },
): Promise<TickSummary> {
  const summary: TickSummary = { computed: 0, skipped: 0, failed: 0 };
  const due = await calculator.findDue();

  let started = 0;
  for (const id of due) {
    if (deadline !== undefined && Date.now() >= deadline) {
      break;
    }
    started += 1;
    try {
      // Without waiting: a phenomenon being computed elsewhere, such as by publishing, is left to it.
      summary[(await calculator.recompute(id, { wait: false })) === "computed" ? "computed" : "skipped"] += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error(`Computing the index of phenomenon ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (due.length > 0) {
    const left = due.length - started;
    logger.log(
      `Index tick: ${summary.computed} computed, ${summary.skipped} skipped, ${summary.failed} failed` +
        (left > 0 ? `, ${left} left for the next tick.` : "."),
    );
  }
  return summary;
}
