import { ok, type Result } from "neverthrow";
import type { AccountRepositoryPort } from "../database/account.repository.port.js";
import type { Account, ProfileEdit } from "../domain/account.entity.js";
import type { IdentityProviderPort, UpdateProfileError } from "../domain/identity-provider.port.js";

/**
 * Changes an account's details: the identity provider first, then the account. If the
 * identity provider refuses or cannot be reached, nothing has changed anywhere. If saving
 * the account fails afterwards, the identity provider already has the new details and the
 * account catches up from the next token that carries them.
 */
export async function applyProfileEdit(
  identity: IdentityProviderPort,
  accounts: AccountRepositoryPort,
  account: Account,
  edit: ProfileEdit,
): Promise<Result<Account, UpdateProfileError>> {
  // Outside any transaction: a database connection should not wait on another service.
  const written = await identity.updateProfile(account.subject, edit);
  if (written.isErr()) {
    return written.map(() => account);
  }
  account.editProfile(written.value, new Date());
  await accounts.saveProfile(account);
  return ok(account);
}
