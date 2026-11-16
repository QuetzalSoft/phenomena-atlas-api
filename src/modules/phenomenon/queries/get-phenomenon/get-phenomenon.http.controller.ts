import { Controller, Get, Param, ParseIntPipe, Req } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { type AuthorizedRequest, callerHas } from "../../../account/account.public.js";
import { PhenomenonNotFoundError } from "../../domain/phenomenon.errors.js";
import { GetPhenomenonQuery } from "./get-phenomenon.query.js";

@Controller()
export class GetPhenomenonHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("phenomena/:phenomenonId")
  async getPhenomenon(
    @Param("phenomenonId", ParseIntPipe) id: number,
    @Req() request: AuthorizedRequest,
  ): Promise<Schemas["Phenomenon"]> {
    // The contract: drafts and archived phenomena exist only for admins.
    const phenomenon = await this.queryBus.execute(new GetPhenomenonQuery(id, { includeUnpublished: callerHas(request, "admin") }));
    if (!phenomenon) {
      const error = new PhenomenonNotFoundError();
      throw new ContractHttpException(404, error.code, error.message);
    }
    return phenomenon;
  }
}
