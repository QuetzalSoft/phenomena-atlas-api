import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, Req } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { type AuthorizedRequest, callerHas, callerOf } from "../../../account/account.public.js";
import { draftFromRequest } from "../../incident-report.mapper.js";
import { GetIncidentReportQuery } from "../../queries/get-incident-report/get-incident-report.query.js";
import { incidentReportHttpError } from "../incident-report-http-error.js";
import { FileIncidentReportCommand } from "./file-incident-report.command.js";

@Controller()
export class FileIncidentReportHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post("phenomena/:phenomenonId/incident-reports")
  @HttpCode(201)
  async fileIncidentReport(
    @Param("phenomenonId", ParseIntPipe) phenomenonId: number,
    @Body() body: Schemas["IncidentReportDraft"],
    @Req() request: AuthorizedRequest,
  ): Promise<Schemas["IncidentReport"]> {
    const result = await this.commandBus.execute(
      new FileIncidentReportCommand(phenomenonId, callerOf(request).id, draftFromRequest(body), callerHas(request, "admin")),
    );
    if (result.isErr()) {
      throw incidentReportHttpError(result.error);
    }
    const report = await this.queryBus.execute(new GetIncidentReportQuery(result.value));
    if (!report) {
      throw new Error(`Incident report ${result.value} was filed but cannot be read back.`);
    }
    return report;
  }
}
