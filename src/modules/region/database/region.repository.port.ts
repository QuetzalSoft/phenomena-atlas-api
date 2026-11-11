import type { PartitionState, PlannedChange } from "../domain/partition-change.js";
import type { PartitionChangeError } from "../domain/region.errors.js";

export interface RegionRepositoryPort {
  /**
   * Waits for any other save to finish and keeps the partition to this transaction until
   * it ends. Then returns its state, or undefined before the initial load.
   */
  lockPartition(): Promise<PartitionState | undefined>;

  /** Writes the change as its version. Returns the ids given to the regions it created, in order. */
  apply(change: PlannedChange, authorAccountId: string): Promise<number[]>;

  /**
   * Checks the partition rules that need geometry against the version just applied: valid
   * geometries, each region inside its municipality, no overlap, no gap. Returns the first
   * rule broken. Overlaps and gaps under one square metre are tolerated. Moves the version's
   * valid geometries onto the storage grid on the way.
   */
  findBrokenRule(version: number): Promise<PartitionChangeError | undefined>;

  /** Runs `work` in one transaction. See TransactionManager.run. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
