export interface PhenomenonIndexCalculatorPort {
  /**
   * Replaces the phenomenon's index with a new computation, in the open transaction or in one
   * of its own. With `wait`, it waits for a computation of the same phenomenon under way;
   * without it, it gives up at once. A phenomenon that is not published, or a database with no
   * partition, is left alone. Resolves to whether it computed.
   */
  recompute(phenomenonId: number, options: { wait: boolean }): Promise<"computed" | "skipped">;

  /** The published phenomena whose index is due, the most overdue first; none while there is no partition. */
  findDue(): Promise<number[]>;
}
