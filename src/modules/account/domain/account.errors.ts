export class AccountNotFoundError extends Error {
  readonly code = "account_not_found";

  constructor() {
    super("No account has that id.");
  }
}

/** Admins cannot change their own role, so the system never loses its last admin. */
export class OwnRoleChangeForbiddenError extends Error {
  readonly code = "own_role_change_forbidden";

  constructor() {
    super("Admins cannot change their own role.");
  }
}

/** Another account already has that email. The identity provider decides, so the rule lives in one place. */
export class EmailAlreadyInUseError extends Error {
  readonly code = "email_already_in_use";

  constructor() {
    super("Another account already uses that email.");
  }
}

/** The identity provider refused a value the request body's limits let through. */
export class InvalidAccountDetailsError extends Error {
  readonly code = "invalid_account_details";

  constructor() {
    super("The identity provider did not accept those details.");
  }
}

/** The identity provider could not be reached, or failed in a way the caller cannot fix. Nothing changed. */
export class AccountUpdateUnavailableError extends Error {
  readonly code = "account_update_unavailable";

  constructor(options?: ErrorOptions) {
    super("The account could not be updated right now. Nothing was changed.", options);
  }
}
