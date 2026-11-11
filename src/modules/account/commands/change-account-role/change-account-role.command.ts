import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Account } from "../../domain/account.entity.js";
import type { AccountNotFoundError, OwnRoleChangeForbiddenError } from "../../domain/account.errors.js";
import type { Role } from "../../domain/role.js";

export class ChangeAccountRoleCommand extends Command<
  Result<Account, AccountNotFoundError | OwnRoleChangeForbiddenError>
> {
  constructor(
    readonly accountId: string,
    readonly role: Role,
    readonly changedBy: Account,
  ) {
    super();
  }
}
