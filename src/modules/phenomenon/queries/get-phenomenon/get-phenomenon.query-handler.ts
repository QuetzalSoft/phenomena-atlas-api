import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import type { Kysely } from "kysely";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { phenomenonResponse } from "../../phenomenon.mapper.js";
import { GetPhenomenonQuery } from "./get-phenomenon.query.js";

@QueryHandler(GetPhenomenonQuery)
export class GetPhenomenonQueryHandler implements IQueryHandler<GetPhenomenonQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute({ id, visibility }: GetPhenomenonQuery): Promise<Schemas["Phenomenon"] | undefined> {
    let query = this.db.selectFrom("phenomenon").selectAll().where("id", "=", id);
    if (!visibility.includeUnpublished) {
      query = query.where("status", "=", "published");
    }
    const row = await query.executeTakeFirst();
    return row && phenomenonResponse(row);
  }
}
