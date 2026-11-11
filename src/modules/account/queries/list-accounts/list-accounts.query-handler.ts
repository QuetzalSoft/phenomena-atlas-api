import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { type Kysely, sql } from "kysely";
import { err, ok, type Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { accountFromRow, accountResponse } from "../../account.mapper.js";
import { decodeCursor, encodeCursor, type InvalidCursorError } from "./account-cursor.js";
import { ListAccountsQuery } from "./list-accounts.query.js";

@QueryHandler(ListAccountsQuery)
export class ListAccountsQueryHandler implements IQueryHandler<ListAccountsQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute({ limit, cursor }: ListAccountsQuery): Promise<Result<Schemas["AccountPage"], InvalidCursorError>> {
    let after;
    if (cursor !== undefined) {
      const decoded = decodeCursor(cursor);
      if (decoded.isErr()) {
        return err(decoded.error);
      }
      after = decoded.value;
    }

    let query = this.db
      .selectFrom("account")
      .selectAll()
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_created_at"))
      .orderBy("created_at")
      .orderBy("id")
      // One extra row tells whether another page follows.
      .limit(limit + 1);
    if (after) {
      query = query.where(sql<boolean>`(created_at, id) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`);
    }
    const rows = await query.execute();

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return ok({
      items: page.map((row) => accountResponse(accountFromRow(row).toProps())),
      ...(rows.length > limit && last && { nextCursor: encodeCursor({ createdAt: last.cursor_created_at, id: last.id }) }),
    });
  }
}
