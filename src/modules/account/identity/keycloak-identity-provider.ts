import { Inject, Injectable, Logger } from "@nestjs/common";
import { err, ok, type Result } from "neverthrow";
import { KEYCLOAK_ADMIN_OPTIONS, type KeycloakAdminOptions } from "../../../libs/identity/keycloak-admin-options.js";
import type { ProfileEdit } from "../domain/account.entity.js";
import {
  AccountUpdateUnavailableError,
  EmailAlreadyInUseError,
  InvalidAccountDetailsError,
} from "../domain/account.errors.js";
import type { IdentityProviderPort, UpdateProfileError } from "../domain/identity-provider.port.js";

const requestTimeoutMs = 5000;
/** A token is renewed this long before it expires, so one never expires mid-request. */
const renewMarginMs = 30_000;

/** Edits users through Keycloak's Admin REST API, as a service account with the least rights it needs. */
@Injectable()
export class KeycloakIdentityProvider implements IdentityProviderPort {
  private readonly logger = new Logger(KeycloakIdentityProvider.name);
  private cached?: { token: string; renewAt: number };

  constructor(@Inject(KEYCLOAK_ADMIN_OPTIONS) private readonly options: KeycloakAdminOptions) {}

  async updateProfile(subject: string, edit: ProfileEdit): Promise<Result<ProfileEdit, UpdateProfileError>> {
    try {
      const token = await this.serviceToken();
      const userUrl = `${this.options.adminUrl}/users/${encodeURIComponent(subject)}`;
      const headers = { authorization: `Bearer ${token}` };

      // Keycloak's update replaces the user. Sending only three fields would clear the rest
      // of the profile, so the current user is read first and only those fields change.
      const current = await fetch(userUrl, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
      if (!current.ok) {
        return this.unavailable(`reading the user answered ${current.status}`, current.status);
      }
      const user = (await current.json()) as Record<string, unknown>;

      const response = await fetch(userUrl, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ ...user, firstName: edit.firstName, lastName: edit.lastName, email: edit.email }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) {
        return ok(await this.savedProfile(userUrl, headers, edit));
      }
      if (response.status === 409) {
        return err(new EmailAlreadyInUseError());
      }
      if (response.status === 400) {
        return err(new InvalidAccountDetailsError());
      }
      return this.unavailable(`updating the user answered ${response.status}`, response.status);
    } catch (error) {
      this.logger.error(`Could not update an account in Keycloak: ${describe(error)}`);
      return err(new AccountUpdateUnavailableError({ cause: error }));
    }
  }

  /**
   * The details as Keycloak saved them, which may differ from what was sent: it keeps emails
   * in lower case. The update already succeeded, so if they cannot be read back, the edit is
   * kept as sent and the account catches up from the next token.
   */
  private async savedProfile(userUrl: string, headers: Record<string, string>, edit: ProfileEdit): Promise<ProfileEdit> {
    try {
      const response = await fetch(userUrl, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
      if (!response.ok) {
        throw new Error(`reading the user back answered ${response.status}`);
      }
      const saved = (await response.json()) as Partial<ProfileEdit>;
      return { firstName: saved.firstName ?? edit.firstName, lastName: saved.lastName ?? edit.lastName, email: saved.email ?? edit.email };
    } catch (error) {
      this.logger.warn(`Updated an account in Keycloak but could not read it back: ${describe(error)}`);
      return edit;
    }
  }

  private unavailable(reason: string, status: number): Result<never, AccountUpdateUnavailableError> {
    // A 401 or 403 means the token or the service account's rights are wrong. Dropping the
    // cached token lets the next request start over, and the log tells an operator why.
    if (status === 401 || status === 403) {
      this.cached = undefined;
    }
    this.logger.error(`Could not update an account in Keycloak: ${reason}.`);
    return err(new AccountUpdateUnavailableError());
  }

  private async serviceToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.renewAt) {
      return this.cached.token;
    }
    const response = await fetch(this.options.tokenUrl, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Keycloak refused the service account: ${response.status}`);
    }
    const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
    this.cached = { token: access_token, renewAt: Date.now() + expires_in * 1000 - renewMarginMs };
    return access_token;
  }
}

/** The error's message only, so a log never carries a request body or a secret. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
