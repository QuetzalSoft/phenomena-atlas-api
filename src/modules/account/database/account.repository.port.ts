import type { Principal } from "../../../libs/auth/access-token-verifier.js";
import type { Account } from "../domain/account.entity.js";

export interface AccountRepositoryPort {
  findById(id: string): Promise<Account | undefined>;
  /** Accounts whose email matches, ignoring case. The identity provider usually keeps emails unique. */
  findByEmail(email: string): Promise<Account[]>;
  /**
   * The caller's account, created with the role `user` if it does not exist yet. Its profile
   * is refreshed from the token when it changed.
   */
  ensureForPrincipal(principal: Principal): Promise<Account>;
  /** The account for that identity provider id, created with no profile if it does not exist. */
  ensureForSubject(subject: string): Promise<{ account: Account; created: boolean }>;
  /** Writes the account's role. */
  save(account: Account): Promise<void>;
  /** Runs `work` in one transaction. See TransactionManager.run. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
