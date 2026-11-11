import { Controller, Get, Query } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { operations, Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { ListAccountsQuery } from "./list-accounts.query.js";

type ListAccountsParams = NonNullable<operations["Accounts_listAccounts"]["parameters"]["query"]>;

const defaultLimit = 50;

@Controller()
export class ListAccountsHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("accounts")
  async listAccounts(@Query() params: ListAccountsParams): Promise<Schemas["AccountPage"]> {
    // The validator has checked the range, but query values may still arrive as strings.
    const limit = params.limit === undefined ? defaultLimit : Number(params.limit);
    const result = await this.queryBus.execute(new ListAccountsQuery(limit, params.cursor));
    return result.match(
      (page) => page,
      (error) => {
        throw new ContractHttpException(400, error.code, error.message);
      },
    );
  }
}
