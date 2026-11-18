import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, ok, type Result } from "neverthrow";
import type { IncidentReportRepositoryPort } from "../../database/incident-report.repository.port.js";
import { IncidentReportNotFoundError } from "../../domain/incident-report.errors.js";
import { INCIDENT_REPORT_REPOSITORY } from "../../incident-report.di-tokens.js";
import { RemoveIncidentReportCommand } from "./remove-incident-report.command.js";

@CommandHandler(RemoveIncidentReportCommand)
export class RemoveIncidentReportService implements ICommandHandler<RemoveIncidentReportCommand> {
  constructor(@Inject(INCIDENT_REPORT_REPOSITORY) private readonly reports: IncidentReportRepositoryPort) {}

  async execute({ id }: RemoveIncidentReportCommand): Promise<Result<void, IncidentReportNotFoundError>> {
    return (await this.reports.delete(id)) ? ok(undefined) : err(new IncidentReportNotFoundError());
  }
}
