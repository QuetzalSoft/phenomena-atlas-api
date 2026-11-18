import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, ok, type Result } from "neverthrow";
import { PhenomenonNotFoundError, PhenomenonReader } from "../../../phenomenon/phenomenon.public.js";
import { RegionReader } from "../../../region/region.public.js";
import type { IncidentReportRepositoryPort } from "../../database/incident-report.repository.port.js";
import { checkIncidentReport } from "../../domain/incident-report.js";
import { RegionNotFoundError } from "../../domain/incident-report.errors.js";
import { INCIDENT_REPORT_REPOSITORY } from "../../incident-report.di-tokens.js";
import { FileIncidentReportCommand, type FileIncidentReportError } from "./file-incident-report.command.js";

/** Incident dates are days in the metropolitan area (ADR 0013). */
const metropolitanTimeZone = "America/Mexico_City";

@CommandHandler(FileIncidentReportCommand)
export class FileIncidentReportService implements ICommandHandler<FileIncidentReportCommand> {
  constructor(
    @Inject(INCIDENT_REPORT_REPOSITORY) private readonly reports: IncidentReportRepositoryPort,
    private readonly phenomena: PhenomenonReader,
    private readonly regions: RegionReader,
  ) {}

  execute({ phenomenonId, authorAccountId, draft, callerSeesUnpublished }: FileIncidentReportCommand): Promise<Result<number, FileIncidentReportError>> {
    // The phenomenon and the partition stay as read until the report is stored, so it is
    // never filed against a definition or a region that changed in between.
    return this.reports.transaction(async () => {
      const phenomenon = await this.phenomena.findShared(phenomenonId);
      if (!phenomenon || (phenomenon.status !== "published" && !callerSeesUnpublished)) {
        return err(new PhenomenonNotFoundError());
      }
      const checked = checkIncidentReport(draft, phenomenon, today());
      if (checked.isErr()) {
        return err(checked.error);
      }
      if (!(await this.regions.findCurrentShared(draft.regionId))) {
        return err(new RegionNotFoundError());
      }
      return ok(await this.reports.insert({ ...draft, phenomenonId, authorAccountId }));
    });
  }
}

/** Today in the metropolitan area, as YYYY-MM-DD. */
function today(): string {
  // The Canadian English format is YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: metropolitanTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
