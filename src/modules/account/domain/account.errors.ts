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
