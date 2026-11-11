import { createRemoteJWKSet, errors, jwtVerify } from "jose";

export interface AccessTokenOptions {
  /** The `iss` every token must carry: the Keycloak realm URL. */
  issuer: string;
  /** The `aud` every token must include, so a token minted for another service is refused. */
  audience: string;
  /** Where the issuer publishes its signing keys. */
  jwksUrl: string;
}

/** Who made the request, as proven by a valid access token. */
export interface Principal {
  /** The identity provider's id for the user, stable across sessions. */
  subject: string;
  /** The profile the token carries, absent when the identity provider does not include it. */
  username?: string;
  name?: string;
  email?: string;
}

/** The token is missing, malformed, expired, or not meant for this API. Answers 401. */
export class InvalidAccessTokenError extends Error {
  readonly status = 401;

  constructor(options?: ErrorOptions) {
    super("The access token is missing, invalid or expired.", options);
  }
}

/** The signing keys could not be fetched, so no token can be checked. Answers 500. */
export class TokenIssuerUnavailableError extends Error {
  readonly status = 500;
}

// Failures that mean the token itself is bad. Anything else, such as the issuer being
// unreachable, is our problem and must not look like the caller's fault.
const tokenErrors = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

/** A profile claim as a property, or nothing when the token lacks it or it is not a string. */
function stringClaim<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === "string" && value ? ({ [key]: value } as Record<K, string>) : {};
}

/** Checks an access token's signature, issuer, audience and expiry. */
export class AccessTokenVerifier {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly options: AccessTokenOptions) {
    this.keys = createRemoteJWKSet(new URL(options.jwksUrl));
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        // Keycloak signs with RS256 by default. Pinning it refuses tokens that pick their own.
        algorithms: ["RS256"],
        requiredClaims: ["sub"],
      });
      return {
        subject: payload.sub as string,
        ...stringClaim("username", payload.preferred_username),
        ...stringClaim("name", payload.name),
        ...stringClaim("email", payload.email),
      };
    } catch (error) {
      if (tokenErrors.some((tokenError) => error instanceof tokenError)) {
        throw new InvalidAccessTokenError({ cause: error });
      }
      throw new TokenIssuerUnavailableError("Could not fetch the token issuer's signing keys.", {
        cause: error,
      });
    }
  }
}
