import { Body, Controller, Param, Put, Req } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { accountResponse } from "../../account.mapper.js";
import { type AuthorizedRequest, callerOf } from "../../authorization/authorization.guard.js";
import { AccountNotFoundError } from "../../domain/account.errors.js";
import { ChangeAccountRoleCommand } from "./change-account-role.command.js";

@Controller()
export class ChangeAccountRoleHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Put("accounts/:accountId/role")
  async changeAccountRole(
    @Param("accountId") accountId: string,
    @Body() body: { role: Schemas["Role"] },
    @Req() request: AuthorizedRequest,
  ): Promise<Schemas["Account"]> {
    const result = await this.commandBus.execute(new ChangeAccountRoleCommand(accountId, body.role, callerOf(request)));
    return result.match(
      (account) => accountResponse(account.toProps()),
      (error) => {
        throw new ContractHttpException(error instanceof AccountNotFoundError ? 404 : 403, error.code, error.message);
      },
    );
  }
}
