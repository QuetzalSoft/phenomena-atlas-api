import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { ContractHttpException } from "../../../libs/api/contract-http.exception.js";
import type { Principal } from "../../../libs/auth/access-token-verifier.js";
import { ACCOUNT_REPOSITORY } from "../account.di-tokens.js";
import type { AccountRepositoryPort } from "../database/account.repository.port.js";
import type { Account } from "../domain/account.entity.js";
import { isRole, roleSatisfies } from "../domain/role.js";

/** The extension through which the contract states the minimum role of an operation. */
export const minimumRoleExtension = "x-minimum-role";

interface ContractOperation {
  security?: Record<string, unknown>[];
  [minimumRoleExtension]?: unknown;
}

/** What the validator and this guard leave on a request that reaches a controller. */
export interface AuthorizedRequest extends Request {
  openapi?: { schema: ContractOperation };
  /** Set when the request carried a valid token. */
  principal?: Principal;
  /** The caller's account. Set whenever `principal` is. */
  account?: Account;
}

/**
 * Applies the minimum role the contract states for each operation. The validator has
 * already checked the token for every operation the contract protects, so by the time this
 * runs a protected operation always has a principal.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepositoryPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const operation = request.openapi?.schema;
    if (!operation) {
      // Only routes the contract declares reach a controller, so this is a wiring bug.
      throw new Error(`No contract operation for ${request.method} ${request.path}.`);
    }

    if (request.principal) {
      request.account = await this.accounts.ensureForPrincipal(request.principal);
    }

    const minimum = operation[minimumRoleExtension];
    if (minimum === undefined) {
      // No minimum role is only valid on an operation anyone may call. An operation without
      // its own `security` inherits the document's, which requires a token.
      if (isPublic(operation)) {
        return true;
      }
      throw new Error(`The contract operation for ${request.method} ${request.path} states no minimum role.`);
    }
    if (!isRole(minimum)) {
      throw new Error(`The contract states an unknown minimum role ${JSON.stringify(minimum)}.`);
    }
    if (!request.account || !roleSatisfies(request.account.role, minimum)) {
      throw new ContractHttpException(403, "forbidden", "Your role does not allow this operation.");
    }
    return true;
  }
}

/** The caller's account, on an operation the contract protects. */
export function callerOf(request: AuthorizedRequest): Account {
  if (!request.account) {
    throw new Error("The operation needs the caller's account, but the request has none.");
  }
  return request.account;
}

function isPublic(operation: ContractOperation): boolean {
  return operation.security?.some((requirement) => Object.keys(requirement).length === 0) ?? false;
}
