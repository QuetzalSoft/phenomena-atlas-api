import type { Phenomenon, PhenomenonDefinition } from "../domain/phenomenon.entity.js";

export interface PhenomenonRepositoryPort {
  /** Stores a new draft at revision 1 and returns its id. */
  insert(definition: PhenomenonDefinition): Promise<number>;

  /**
   * The phenomenon with that id, kept to this transaction until it ends so no other change
   * interleaves, or undefined when there is none.
   */
  findForUpdate(id: number): Promise<Phenomenon | undefined>;

  /** Writes the phenomenon's current definition, status and revision. */
  save(phenomenon: Phenomenon): Promise<void>;

  delete(id: number): Promise<void>;

  /** Runs `work` in one transaction. See TransactionManager.run. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
