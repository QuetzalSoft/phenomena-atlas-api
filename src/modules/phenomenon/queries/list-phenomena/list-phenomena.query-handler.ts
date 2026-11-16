import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { type Kysely, sql } from "kysely";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { phenomenonResponse } from "../../phenomenon.mapper.js";
import { ListPhenomenaQuery } from "./list-phenomena.query.js";

@QueryHandler(ListPhenomenaQuery)
export class ListPhenomenaQueryHandler implements IQueryHandler<ListPhenomenaQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute({ status }: ListPhenomenaQuery): Promise<Schemas["PhenomenonList"]> {
    let query = this.db.selectFrom("phenomenon").selectAll().orderBy(sql`lower(name)`).orderBy("id");
    if (status !== undefined) {
      query = query.where("status", "=", status);
    }
    const rows = await query.execute();
    return { items: rows.map(phenomenonResponse) };
  }
}
