import type { Result } from "neverthrow";
import type {
  AccountUpdateUnavailableError,
  EmailAlreadyInUseError,
  InvalidAccountDetailsError,
} from "./account.errors.js";
import type { ProfileEdit } from "./account.entity.js";

export type UpdateProfileError = EmailAlreadyInUseError | InvalidAccountDetailsError | AccountUpdateUnavailableError;

/** The identity provider, which is the source of truth for the details of an account. */
export interface IdentityProviderPort {
  /**
   * Writes the person's first name, last name and email. It either changes all three or
   * none, and reports why it did not. `subject` is the identity provider's id for the person.
   * Answers the details as the identity provider keeps them, which may differ from `edit`,
   * such as an email in lower case.
   */
  updateProfile(subject: string, edit: ProfileEdit): Promise<Result<ProfileEdit, UpdateProfileError>>;
}
