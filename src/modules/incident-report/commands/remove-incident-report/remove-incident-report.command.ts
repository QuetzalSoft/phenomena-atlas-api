import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { IncidentReportNotFoundError } from "../../domain/incident-report.errors.js";

/** Removes a report, for abuse or to erase personal data. */
export class RemoveIncidentReportCommand extends Command<Result<void, IncidentReportNotFoundError>> {
  constructor(readonly id: number) {
    super();
  }
}
