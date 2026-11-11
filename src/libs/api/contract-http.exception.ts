import { HttpException } from "@nestjs/common";

/**
 * A failure answered with a specific contract error code, such as `account_not_found`,
 * rather than the generic code for its status.
 */
export class ContractHttpException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super(message, status);
  }
}
