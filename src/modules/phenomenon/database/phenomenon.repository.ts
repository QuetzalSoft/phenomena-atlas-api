import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { TransactionManager } from "../../../libs/db/transaction-manager.js";
import type { NewPhenomenon, Phenomenon } from "../domain/phenomenon.entity.js";
import { phenomenonFromRow } from "../phenomenon.mapper.js";
import type { PhenomenonRepositoryPort } from "./phenomenon.repository.port.js";

@Injectable()
export class PhenomenonRepository implements PhenomenonRepositoryPort {
  constructor(private readonly transactions: TransactionManager) {}

  private get db() {
    return this.transactions.connection;
  }

  async insert(phenomenon: NewPhenomenon): Promise<number> {
    const row = await this.db
      .insertInto("phenomenon")
      .values({
        name: phenomenon.name,
        description: phenomenon.description,
        characteristics: JSON.stringify(phenomenon.characteristics),
        weighting_function: JSON.stringify(phenomenon.weightingFunction),
        refresh_interval_minutes: phenomenon.refreshIntervalMinutes,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async findForUpdate(id: number): Promise<Phenomenon | undefined> {
    const row = await this.db.selectFrom("phenomenon").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
    return row && phenomenonFromRow(row);
  }

  async save(phenomenon: Phenomenon): Promise<void> {
    const props = phenomenon.toProps();
    await this.db
      .updateTable("phenomenon")
      .set({
        name: props.name,
        description: props.description,
        status: props.status,
        characteristics: JSON.stringify(props.characteristics),
        weighting_function: JSON.stringify(props.weightingFunction),
        refresh_interval_minutes: props.refreshIntervalMinutes,
        revision: props.revision,
        updated_at: sql`now()`,
      })
      .where("id", "=", props.id)
      .execute();
  }

  async delete(id: number): Promise<void> {
    await this.db.deleteFrom("phenomenon").where("id", "=", id).execute();
  }

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.transactions.run(work);
  }
}
