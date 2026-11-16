import { Controller, Get, Query, Req } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { operations, Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { type AuthorizedRequest, callerHas } from "../../../account/account.public.js";
import { ListPhenomenaQuery } from "./list-phenomena.query.js";

type ListPhenomenaParams = NonNullable<operations["Phenomena_listPhenomena"]["parameters"]["query"]>;

@Controller()
export class ListPhenomenaHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("phenomena")
  async listPhenomena(@Query() params: ListPhenomenaParams, @Req() request: AuthorizedRequest): Promise<Schemas["PhenomenonList"]> {
    // The contract: only admins see drafts and archived phenomena, or may ask for them.
    if (callerHas(request, "admin")) {
      return this.queryBus.execute(new ListPhenomenaQuery(params.status));
    }
    if (params.status !== undefined && params.status !== "published") {
      throw new ContractHttpException(403, "forbidden", "Only admins see phenomena that are not published.");
    }
    return this.queryBus.execute(new ListPhenomenaQuery("published"));
  }
}
