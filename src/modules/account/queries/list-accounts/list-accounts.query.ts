import { Query } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import type { InvalidCursorError } from "./account-cursor.js";

export class ListAccountsQuery extends Query<Result<Schemas["AccountPage"], InvalidCursorError>> {
  constructor(
    readonly limit: number,
    readonly cursor?: string,
  ) {
    super();
  }
}
