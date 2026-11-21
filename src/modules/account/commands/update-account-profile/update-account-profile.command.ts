import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Account, ProfileEdit } from "../../domain/account.entity.js";
import type { AccountNotFoundError } from "../../domain/account.errors.js";
import type { UpdateProfileError } from "../../domain/identity-provider.port.js";

export class UpdateAccountProfileCommand extends Command<Result<Account, AccountNotFoundError | UpdateProfileError>> {
  constructor(
    readonly accountId: string,
    readonly edit: ProfileEdit,
  ) {
    super();
  }
}
