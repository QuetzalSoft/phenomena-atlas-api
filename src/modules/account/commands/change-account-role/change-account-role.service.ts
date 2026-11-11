import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, ok, type Result } from "neverthrow";
import { ACCOUNT_REPOSITORY } from "../../account.di-tokens.js";
import type { AccountRepositoryPort } from "../../database/account.repository.port.js";
import type { Account } from "../../domain/account.entity.js";
import { AccountNotFoundError, type OwnRoleChangeForbiddenError } from "../../domain/account.errors.js";
import { ChangeAccountRoleCommand } from "./change-account-role.command.js";

@CommandHandler(ChangeAccountRoleCommand)
export class ChangeAccountRoleService implements ICommandHandler<ChangeAccountRoleCommand> {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepositoryPort) {}

  async execute(
    command: ChangeAccountRoleCommand,
  ): Promise<Result<Account, AccountNotFoundError | OwnRoleChangeForbiddenError>> {
    return this.accounts.transaction(async () => {
      const account = await this.accounts.findById(command.accountId);
      if (!account) {
        return err(new AccountNotFoundError());
      }
      const changed = account.changeRole(command.role, command.changedBy);
      if (changed.isErr()) {
        return err(changed.error);
      }
      await this.accounts.save(account);
      return ok(account);
    });
  }
}
