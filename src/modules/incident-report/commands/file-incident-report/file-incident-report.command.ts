import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { PhenomenonNotFoundError } from "../../../phenomenon/phenomenon.public.js";
import type { IncidentReportDraft } from "../../domain/incident-report.js";
import type { IncidentReportRejectedError, PhenomenonNotAcceptingReportsError } from "../../domain/incident-report.errors.js";

export type FileIncidentReportError = IncidentReportRejectedError | PhenomenonNotFoundError | PhenomenonNotAcceptingReportsError;

/** Files a report about a phenomenon. Resolves to its id. */
export class FileIncidentReportCommand extends Command<Result<number, FileIncidentReportError>> {
  constructor(
    readonly phenomenonId: number,
    readonly authorAccountId: string,
    readonly draft: IncidentReportDraft,
    /** Admins see drafts and archived phenomena; anyone else is told they do not exist. */
    readonly callerSeesUnpublished: boolean,
  ) {
    super();
  }
}
