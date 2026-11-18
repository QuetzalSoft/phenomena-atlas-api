import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../libs/db/transaction-manager.js";
import type { Characteristic } from "../domain/characteristic.js";
import type { PhenomenonStatus } from "../domain/phenomenon.entity.js";

/** What other modules may read about a phenomenon. */
export interface PhenomenonSummary {
  id: number;
  name: string;
  status: PhenomenonStatus;
  characteristics: Characteristic[];
}

/** Reads phenomena for other modules, inside their transaction when one is open. */
@Injectable()
export class PhenomenonReader {
  constructor(private readonly transactions: TransactionManager) {}

  /**
   * The phenomenon with that id, or undefined. Inside a transaction it stays as read until
   * the transaction ends: no change of status or definition can interleave.
   */
  async findShared(id: number): Promise<PhenomenonSummary | undefined> {
    const row = await this.transactions.connection
      .selectFrom("phenomenon")
      .select(["id", "name", "status", "characteristics"])
      .where("id", "=", id)
      .forShare()
      .executeTakeFirst();
    // Only ever written from a checked domain definition.
    return row && { id: row.id, name: row.name, status: row.status, characteristics: row.characteristics as Characteristic[] };
  }
}
