import { Query } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import type { Role } from "../../domain/role.js";
import type { InvalidCursorError } from "./account-cursor.js";

/** Optional, and combined with AND: an account is listed only when it matches all of them. */
export interface AccountFilters {
  role?: Role;
  /** A case-insensitive substring of the username, name or email, taken literally. */
  text?: string;
  /** Inclusive. */
  createdFrom?: Date;
  /** Exclusive. */
  createdBefore?: Date;
}

export class InvalidDateRangeError extends Error {
  readonly code = "invalid_date_range";

  constructor() {
    super("createdFrom must be earlier than createdBefore.");
  }
}

export type ListAccountsError = InvalidCursorError | InvalidDateRangeError;

export class ListAccountsQuery extends Query<Result<Schemas["AccountPage"], ListAccountsError>> {
  constructor(
    readonly limit: number,
    readonly cursor?: string,
    readonly filters: AccountFilters = {},
  ) {
    super();
  }
}
