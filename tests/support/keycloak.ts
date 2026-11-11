import { inject } from "vitest";
import type { AccessTokenOptions } from "../../src/libs/auth/access-token-verifier.js";

export const realm = "phenomena-atlas";

/** The web client, plus the ability to log in with a password, which only tests need. */
export const testClientId = "phenomena-atlas-web-tests";
/** Like the test client, but its tokens are not meant for the API. */
export const otherAudienceClientId = "other-audience-tests";

/** The settings the API uses to accept tokens from the test Keycloak. */
export function testAuthOptions(): AccessTokenOptions {
  const issuer = `${inject("keycloakUrl")}/realms/${realm}`;
  return {
    issuer,
    audience: "phenomena-atlas-api",
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
  };
}

/** The same settings as environment variables, for `loadAppConfig`. */
export function testAuthEnv(): Record<string, string> {
  const { issuer, audience, jwksUrl } = testAuthOptions();
  return { AUTH_ISSUER: issuer, AUTH_AUDIENCE: audience, AUTH_JWKS_URL: jwksUrl };
}

/**
 * People who exist only in the test Keycloak, so each spec can sign in as someone no other
 * spec touches. Their password is their username.
 */
export const testUsernames = ["alice", "bob", "carol", "dave", "erin", "frank"] as const;
export type TestUsername = (typeof testUsernames)[number];

/** The profile Keycloak holds for a test user, and so the one their tokens carry. */
export function testUserProfile(username: TestUsername) {
  const firstName = username[0]?.toUpperCase() + username.slice(1);
  return { username, email: `${username}@tests.phenomena-atlas.local`, firstName, lastName: "Tester" };
}

export interface IssueOptions {
  clientId?: string;
  /** The realm's `dev` user by default. */
  username?: "dev" | TestUsername;
}

/** Logs in and returns the access token Keycloak issues. */
export async function issueAccessToken({ clientId = testClientId, username = "dev" }: IssueOptions = {}): Promise<string> {
  const response = await fetch(`${testAuthOptions().issuer}/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: clientId, username, password: username }),
  });
  if (!response.ok) {
    throw new Error(`Keycloak refused the login: ${response.status} ${await response.text()}`);
  }
  const { access_token } = (await response.json()) as { access_token: string };
  return access_token;
}
