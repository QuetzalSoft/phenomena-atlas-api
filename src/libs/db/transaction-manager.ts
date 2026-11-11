import { AsyncLocalStorage } from "node:async_hooks";
import { Inject, Injectable } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";
import { DATABASE, type Database } from "./database.js";

/**
 * Carries the open transaction through the async call chain, so a service can open one and
 * every repository it calls writes inside it without passing it around.
 */
@Injectable()
export class TransactionManager {
  private readonly active = new AsyncLocalStorage<Transaction<Database>>();

  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  /** What repositories write through: the transaction open in this call chain, or the pool. */
  get connection(): Kysely<Database> {
    return this.active.getStore() ?? this.db;
  }

  /**
   * Runs `work` in a transaction that commits when it resolves and rolls back when it throws.
   * Called again inside `work`, it joins the open transaction instead of starting another.
   */
  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active.getStore()) {
      return work();
    }
    return this.db.transaction().execute((transaction) => this.active.run(transaction, work));
  }
}
