import { Controller, Get, Req } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { type AuthorizedRequest, callerOf } from "../../authorization/authorization.guard.js";
import { GetMyAccountQuery } from "./get-my-account.query.js";

@Controller()
export class GetMyAccountHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("accounts/me")
  getMyAccount(@Req() request: AuthorizedRequest): Promise<Schemas["Account"]> {
    return this.queryBus.execute(new GetMyAccountQuery(callerOf(request).id));
  }
}
