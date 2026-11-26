import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, type Result } from "neverthrow";
import { ACCOUNT_REPOSITORY, IDENTITY_PROVIDER } from "../../account.di-tokens.js";
import type { AccountRepositoryPort } from "../../database/account.repository.port.js";
import type { Account } from "../../domain/account.entity.js";
import { AccountNotFoundError } from "../../domain/account.errors.js";
import type { IdentityProviderPort, UpdateProfileError } from "../../domain/identity-provider.port.js";
import { applyProfileEdit } from "../apply-profile-edit.js";
import { UpdateAccountProfileCommand } from "./update-account-profile.command.js";

@CommandHandler(UpdateAccountProfileCommand)
export class UpdateAccountProfileService implements ICommandHandler<UpdateAccountProfileCommand> {
  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepositoryPort,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProviderPort,
  ) {}

  async execute(
    command: UpdateAccountProfileCommand,
  ): Promise<Result<Account, AccountNotFoundError | UpdateProfileError>> {
    const account = await this.accounts.findById(command.accountId);
    if (!account) {
      return err(new AccountNotFoundError());
    }
    return applyProfileEdit(this.identity, this.accounts, account, command.edit);
  }
}
