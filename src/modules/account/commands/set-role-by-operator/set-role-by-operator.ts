import type { AccountRepositoryPort } from "../../database/account.repository.port.js";
import type { Account } from "../../domain/account.entity.js";
import type { Role } from "../../domain/role.js";

/** Who to change, as the operator names them: an email address, or the identity provider's user id. */
export type OperatorTarget = { email: string } | { subject: string };

export class OperatorTargetError extends Error {}

/**
 * Sets a role from the command line. It is how the first admin is made, and how access is
 * recovered if every admin is lost, so it skips the rule that admins cannot change their
 * own role. Given an identity provider id, it creates the account if that person has never
 * called the API; given an email, the account must already exist.
 */
export async function setRoleByOperator(
  accounts: AccountRepositoryPort,
  target: OperatorTarget,
  role: Role,
): Promise<{ account: Account; created: boolean }> {
  return accounts.transaction(async () => {
    let account: Account;
    let created = false;
    if ("subject" in target) {
      ({ account, created } = await accounts.ensureForSubject(target.subject));
    } else {
      const matches = await accounts.findByEmail(target.email);
      if (matches.length !== 1) {
        throw new OperatorTargetError(
          matches.length === 0
            ? `No account has the email ${target.email}. The person must sign in once, or pass their identity provider id instead.`
            : `${matches.length} accounts have the email ${target.email}. Pass the identity provider id instead.`,
        );
      }
      account = matches[0] as Account;
    }
    account.setRoleByOperator(role);
    await accounts.save(account);
    return { account, created };
  });
}
