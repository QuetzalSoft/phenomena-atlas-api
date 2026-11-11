import type { Selectable } from "kysely";
import type { Schemas } from "../../libs/api/contract.js";
import type { AccountTable } from "../../libs/db/database.js";
import { Account, type AccountProps } from "./domain/account.entity.js";

export type AccountRow = Selectable<AccountTable>;

export function accountFromRow(row: AccountRow): Account {
  return Account.restore({
    id: row.id,
    subject: row.subject,
    ...(row.username !== null && { username: row.username }),
    ...(row.name !== null && { name: row.name }),
    ...(row.email !== null && { email: row.email }),
    role: row.role,
    createdAt: row.created_at,
  });
}

/** The contract's Account, built field by field so nothing internal, such as the subject, leaks. */
export function accountResponse(account: AccountProps): Schemas["Account"] {
  return {
    id: account.id,
    ...(account.username !== undefined && { username: account.username }),
    ...(account.name !== undefined && { name: account.name }),
    ...(account.email !== undefined && { email: account.email }),
    role: account.role,
    createdAt: account.createdAt.toISOString(),
  };
}
