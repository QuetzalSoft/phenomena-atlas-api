import { Body, Controller, Put, Req } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { accountResponse } from "../../account.mapper.js";
import { type AuthorizedRequest, callerOf } from "../../authorization/authorization.guard.js";
import { profileHttpError } from "../profile-http-errors.js";
import { UpdateMyProfileCommand } from "./update-my-profile.command.js";

@Controller()
export class UpdateMyProfileHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Put("accounts/me/profile")
  async updateMyProfile(
    @Body() body: Schemas["AccountProfile"],
    @Req() request: AuthorizedRequest,
  ): Promise<Schemas["Account"]> {
    const result = await this.commandBus.execute(new UpdateMyProfileCommand(callerOf(request), body));
    return result.match(
      (account) => accountResponse(account.toProps()),
      (error) => {
        throw profileHttpError(error);
      },
    );
  }
}
