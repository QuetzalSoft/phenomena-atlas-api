import { Controller, Get, Param, ParseIntPipe, Query } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { operations, Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { PhenomenonNotFoundError } from "../../../phenomenon/phenomenon.public.js";
import { ListPhenomenonIncidentReportsQuery } from "./list-phenomenon-incident-reports.query.js";

type Params = NonNullable<operations["IncidentReports_listPhenomenonIncidentReports"]["parameters"]["query"]>;

const defaultLimit = 50;

@Controller()
export class ListPhenomenonIncidentReportsHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("phenomena/:phenomenonId/incident-reports")
  async listPhenomenonIncidentReports(
    @Param("phenomenonId", ParseIntPipe) phenomenonId: number,
    @Query() params: Params,
  ): Promise<Schemas["IncidentReportPage"]> {
    // The validator has checked the values, but query values may still arrive as strings.
    const limit = params.limit === undefined ? defaultLimit : Number(params.limit);
    const result = await this.queryBus.execute(
      new ListPhenomenonIncidentReportsQuery(phenomenonId, limit, params.cursor, {
        ...(params.regionId !== undefined && { regionId: Number(params.regionId) }),
        ...(params.occurredFrom !== undefined && { occurredFrom: params.occurredFrom }),
        ...(params.occurredBefore !== undefined && { occurredBefore: params.occurredBefore }),
      }),
    );
    return result.match(
      (page) => page,
      (error) => {
        throw new ContractHttpException(error instanceof PhenomenonNotFoundError ? 404 : 400, error.code, error.message);
      },
    );
  }
}
