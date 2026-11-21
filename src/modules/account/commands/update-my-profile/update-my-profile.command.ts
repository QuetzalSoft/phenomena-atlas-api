import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Account, ProfileEdit } from "../../domain/account.entity.js";
import type { UpdateProfileError } from "../../domain/identity-provider.port.js";

export class UpdateMyProfileCommand extends Command<Result<Account, UpdateProfileError>> {
  constructor(
    readonly account: Account,
    readonly edit: ProfileEdit,
  ) {
    super();
  }
}
