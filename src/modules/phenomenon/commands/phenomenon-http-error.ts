import { ContractHttpException } from "../../../libs/api/contract-http.exception.js";
import {
  InvalidStatusTransitionError,
  PhenomenonDefinitionError,
  PhenomenonNotDraftError,
  PhenomenonNotFoundError,
  PhenomenonRevisionConflictError,
} from "../domain/phenomenon.errors.js";

export type PhenomenonCommandError =
  | PhenomenonDefinitionError
  | PhenomenonNotFoundError
  | PhenomenonRevisionConflictError
  | InvalidStatusTransitionError
  | PhenomenonNotDraftError;

/** The contract's answer to a refused phenomenon command. */
export function phenomenonHttpError(error: PhenomenonCommandError): ContractHttpException {
  if (error instanceof PhenomenonDefinitionError) {
    return new ContractHttpException(400, error.code, error.message, { ...error.details });
  }
  if (error instanceof PhenomenonNotFoundError) {
    return new ContractHttpException(404, error.code, error.message);
  }
  return new ContractHttpException(409, error.code, error.message);
}
