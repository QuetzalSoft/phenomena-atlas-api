import { Controller, Delete, HttpCode, Param, ParseIntPipe } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { incidentReportHttpError } from "../incident-report-http-error.js";
import { RemoveIncidentReportCommand } from "./remove-incident-report.command.js";

@Controller()
export class RemoveIncidentReportHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Delete("incident-reports/:incidentReportId")
  @HttpCode(204)
  async removeIncidentReport(@Param("incidentReportId", ParseIntPipe) id: number): Promise<void> {
    const result = await this.commandBus.execute(new RemoveIncidentReportCommand(id));
    if (result.isErr()) {
      throw incidentReportHttpError(result.error);
    }
  }
}
