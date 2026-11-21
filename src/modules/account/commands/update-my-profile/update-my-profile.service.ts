import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import { ACCOUNT_REPOSITORY, IDENTITY_PROVIDER } from "../../account.di-tokens.js";
import type { AccountRepositoryPort } from "../../database/account.repository.port.js";
import type { Account } from "../../domain/account.entity.js";
import type { IdentityProviderPort, UpdateProfileError } from "../../domain/identity-provider.port.js";
import { applyProfileEdit } from "../apply-profile-edit.js";
import { UpdateMyProfileCommand } from "./update-my-profile.command.js";

@CommandHandler(UpdateMyProfileCommand)
export class UpdateMyProfileService implements ICommandHandler<UpdateMyProfileCommand> {
  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepositoryPort,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProviderPort,
  ) {}

  execute(command: UpdateMyProfileCommand): Promise<Result<Account, UpdateProfileError>> {
    return applyProfileEdit(this.identity, this.accounts, command.account, command.edit);
  }
}
