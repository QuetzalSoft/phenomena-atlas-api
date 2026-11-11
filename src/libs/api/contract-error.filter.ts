import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
// The package does not export its base error class from the root.
import { HttpError as ValidatorHttpError } from "express-openapi-validator/dist/framework/types.js";
import type { Schemas } from "./contract.js";

// Stable codes for failures that are not specific to a use case. Codes are part of the
// public product, so they are listed here rather than derived from framework messages.
const codeByStatus: Record<number, string> = {
  400: "invalid_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  406: "not_acceptable",
  413: "payload_too_large",
  415: "unsupported_media_type",
};

/** Renders every failure, including validator failures, as the contract's Error shape. */
@Catch()
export class ContractErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ContractErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ValidatorHttpError && exception.status < 500) {
      // A 405 needs its Allow header, and conformance checks fail without it.
      if (exception.headers?.Allow) {
        response.setHeader("Allow", exception.headers.Allow);
      }
      // RFC 6750: a 401 names the scheme the client must use.
      if (exception.status === 401) {
        response.setHeader("WWW-Authenticate", "Bearer");
      }
      this.send(response, exception.status, exception.message, { errors: exception.errors });
      return;
    }

    if (exception instanceof HttpException && exception.getStatus() < 500) {
      this.send(response, exception.getStatus(), exception.message);
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : exception);
    this.send(response, 500, "An unexpected error occurred.");
  }

  private send(response: Response, status: number, message: string, details?: Record<string, unknown>): void {
    const body: Schemas["Error"] = {
      code: status >= 500 ? "internal_error" : (codeByStatus[status] ?? "request_failed"),
      message,
      ...(details && { details }),
    };
    response.status(status).json(body);
  }
}
