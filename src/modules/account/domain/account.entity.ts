import { err, ok, type Result } from "neverthrow";
import { OwnRoleChangeForbiddenError } from "./account.errors.js";
import type { Role } from "./role.js";

export interface AccountProps {
  id: string;
  /** The identity provider's id for the person. */
  subject: string;
  username?: string;
  name?: string;
  email?: string;
  role: Role;
  createdAt: Date;
}

/** A person known to the API, and the role that decides what they may do. */
export class Account {
  private constructor(private props: AccountProps) {}

  static restore(props: AccountProps): Account {
    return new Account({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get role(): Role {
    return this.props.role;
  }

  /** A copy of the account's state, for mapping it out of the domain. */
  toProps(): AccountProps {
    return { ...this.props };
  }

  /** An admin changes this account's role. Nobody changes their own. */
  changeRole(role: Role, changedBy: Account): Result<void, OwnRoleChangeForbiddenError> {
    if (changedBy.id === this.id) {
      return err(new OwnRoleChangeForbiddenError());
    }
    this.props.role = role;
    return ok(undefined);
  }

  /**
   * The operator sets the role from the command line, outside the API. That path has no
   * acting account, and it is how the first admin is made or a lost one recovered.
   */
  setRoleByOperator(role: Role): void {
    this.props.role = role;
  }
}
