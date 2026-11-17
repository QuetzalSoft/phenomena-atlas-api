import { ContractHttpException } from "../../../libs/api/contract-http.exception.js";
import { PhenomenonNotFoundError } from "../../phenomenon/phenomenon.public.js";
import {
  IncidentReportNotFoundError,
  IncidentReportRejectedError,
  type PhenomenonNotAcceptingReportsError,
} from "../domain/incident-report.errors.js";

export type IncidentReportCommandError =
  | IncidentReportRejectedError
  | PhenomenonNotFoundError
  | PhenomenonNotAcceptingReportsError
  | IncidentReportNotFoundError;

/** The contract's answer to a refused incident report command. */
export function incidentReportHttpError(error: IncidentReportCommandError): ContractHttpException {
  if (error instanceof IncidentReportRejectedError) {
    return new ContractHttpException(400, error.code, error.message, { ...error.details });
  }
  if (error instanceof PhenomenonNotFoundError || error instanceof IncidentReportNotFoundError) {
    return new ContractHttpException(404, error.code, error.message);
  }
  return new ContractHttpException(409, error.code, error.message);
}
