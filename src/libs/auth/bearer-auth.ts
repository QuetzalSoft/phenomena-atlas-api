import { Logger } from "@nestjs/common";
import type { Request } from "express";
import {
  type AccessTokenVerifier,
  InvalidAccessTokenError,
  type Principal,
  TokenIssuerUnavailableError,
} from "./access-token-verifier.js";

/** A request that passed the contract's `BearerAuth` scheme. */
export interface AuthenticatedRequest extends Request {
  principal: Principal;
}

const logger = new Logger("BearerAuth");

/**
 * The handler for the contract's `BearerAuth` security scheme. The validator calls it for
 * every operation the contract protects, so which routes need a token is decided by the
 * contract, never by a controller.
 */
export function bearerAuth(verifier: AccessTokenVerifier): (request: Request) => Promise<boolean> {
  return async (request) => {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
    if (!token) {
      throw new InvalidAccessTokenError();
    }
    try {
      (request as AuthenticatedRequest).principal = await verifier.verify(token);
    } catch (error) {
      if (error instanceof TokenIssuerUnavailableError) {
        logger.error(error.message, error.cause instanceof Error ? error.cause.stack : error.cause);
      }
      throw error;
    }
    return true;
  };
}
