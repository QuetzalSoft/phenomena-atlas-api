import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { TransactionManager } from "../../../libs/db/transaction-manager.js";
import type { Phenomenon, PhenomenonDefinition } from "../domain/phenomenon.entity.js";
import { phenomenonFromRow } from "../phenomenon.mapper.js";
import type { PhenomenonRepositoryPort } from "./phenomenon.repository.port.js";

@Injectable()
export class PhenomenonRepository implements PhenomenonRepositoryPort {
  constructor(private readonly transactions: TransactionManager) {}

  private get db() {
    return this.transactions.connection;
  }

  async insert(definition: PhenomenonDefinition): Promise<number> {
    const row = await this.db
      .insertInto("phenomenon")
      .values({
        name: definition.name,
        description: definition.description,
        characteristics: JSON.stringify(definition.characteristics),
        weighting_function: JSON.stringify(definition.weightingFunction),
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
