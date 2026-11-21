import { ContractHttpException } from "../../../libs/api/contract-http.exception.js";
import {
  AccountNotFoundError,
  AccountUpdateUnavailableError,
  EmailAlreadyInUseError,
  InvalidAccountDetailsError,
} from "../domain/account.errors.js";

type ProfileError =
  | AccountNotFoundError
  | EmailAlreadyInUseError
  | InvalidAccountDetailsError
  | AccountUpdateUnavailableError;

const statusOf = (error: ProfileError): number => {
  if (error instanceof AccountNotFoundError) return 404;
  if (error instanceof EmailAlreadyInUseError) return 409;
  if (error instanceof InvalidAccountDetailsError) return 400;
  return 503;
};

/** The contract's answer for a refused edit: the status and code its operations document. */
export function profileHttpError(error: ProfileError): ContractHttpException {
  return new ContractHttpException(statusOf(error), error.code, error.message);
}
