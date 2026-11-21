import { Body, Controller, Param, Put } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { accountResponse } from "../../account.mapper.js";
import { profileHttpError } from "../profile-http-errors.js";
import { UpdateAccountProfileCommand } from "./update-account-profile.command.js";

@Controller()
export class UpdateAccountProfileHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Put("accounts/:accountId/profile")
  async updateAccountProfile(
    @Param("accountId") accountId: string,
    @Body() body: Schemas["AccountProfile"],
  ): Promise<Schemas["Account"]> {
    const result = await this.commandBus.execute(new UpdateAccountProfileCommand(accountId, body));
    return result.match(
      (account) => accountResponse(account.toProps()),
      (error) => {
        throw profileHttpError(error);
      },
    );
  }
}
