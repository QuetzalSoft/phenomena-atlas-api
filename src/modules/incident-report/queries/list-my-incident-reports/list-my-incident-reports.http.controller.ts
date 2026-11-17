import { Controller, Get, Query, Req } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { operations, Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { type AuthorizedRequest, callerOf } from "../../../account/account.public.js";
import { ListMyIncidentReportsQuery } from "./list-my-incident-reports.query.js";

type Params = NonNullable<operations["IncidentReports_listMyIncidentReports"]["parameters"]["query"]>;

const defaultLimit = 50;

@Controller()
export class ListMyIncidentReportsHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("accounts/me/incident-reports")
  async listMyIncidentReports(@Query() params: Params, @Req() request: AuthorizedRequest): Promise<Schemas["IncidentReportPage"]> {
    // The validator has checked the values, but query values may still arrive as strings.
    const limit = params.limit === undefined ? defaultLimit : Number(params.limit);
    const phenomenonId = params.phenomenonId === undefined ? undefined : Number(params.phenomenonId);
    const result = await this.queryBus.execute(new ListMyIncidentReportsQuery(callerOf(request).id, limit, params.cursor, phenomenonId));
    return result.match(
      (page) => page,
      (error) => {
        throw new ContractHttpException(400, error.code, error.message);
      },
    );
  }
}
