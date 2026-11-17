import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { TransactionManager } from "../../../libs/db/transaction-manager.js";
import { partitionLockKey } from "./partition-lock.js";

/** What other modules may read about a region. */
export interface RegionSummary {
  id: number;
  name: string;
}

/** Reads regions for other modules, inside their transaction when one is open. */
@Injectable()
export class RegionReader {
  constructor(private readonly transactions: TransactionManager) {}

  /**
   * The region with that id if it is part of the current partition, or undefined. Inside a
   * transaction the partition stays as read until the transaction ends: a save waits for it.
   */
  async findCurrentShared(id: number): Promise<RegionSummary | undefined> {
    const db = this.transactions.connection;
    await sql`SELECT pg_advisory_xact_lock_shared(${partitionLockKey})`.execute(db);
    return db
      .selectFrom("region as r")
      .innerJoin("region_state as s", "s.region_id", "r.id")
      .select(["r.id", "s.name"])
      .where("r.id", "=", id)
      .where("r.retired_in", "is", null)
      .where("s.valid_to", "is", null)
      .executeTakeFirst();
  }
}
