import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { Inject } from "@nestjs/common";
import type { Kysely } from "kysely";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { accountFromRow, accountResponse } from "../../account.mapper.js";
import { GetMyAccountQuery } from "./get-my-account.query.js";

@QueryHandler(GetMyAccountQuery)
export class GetMyAccountQueryHandler implements IQueryHandler<GetMyAccountQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute(query: GetMyAccountQuery): Promise<Schemas["Account"]> {
    const row = await this.db
      .selectFrom("account")
      .selectAll()
      .where("id", "=", query.accountId)
      .executeTakeFirstOrThrow();
    return accountResponse(accountFromRow(row).toProps());
  }
}
