import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { issueAccessToken, otherAudienceClientId, testAuthOptions } from "../../../tests/support/keycloak.js";
import { AccessTokenVerifier, InvalidAccessTokenError, TokenIssuerUnavailableError } from "./access-token-verifier.js";

describe("AccessTokenVerifier", () => {
  it("accepts a token Keycloak issued to the web client, and names the user", async () => {
    const token = await issueAccessToken();

    const principal = await new AccessTokenVerifier(testAuthOptions()).verify(token);

    expect(principal).toEqual({ subject: decodeJwt(token).sub });
  });

  it("refuses a token minted for another audience", async () => {
    const token = await issueAccessToken(otherAudienceClientId);

    await expect(new AccessTokenVerifier(testAuthOptions()).verify(token)).rejects.toThrow(InvalidAccessTokenError);
  });

  it("refuses a token from another issuer", async () => {
    const token = await issueAccessToken();
    const verifier = new AccessTokenVerifier({ ...testAuthOptions(), issuer: "https://elsewhere.example/realms/x" });

    await expect(verifier.verify(token)).rejects.toThrow(InvalidAccessTokenError);
  });

  it("refuses a token whose claims were changed after signing", async () => {
    const token = await issueAccessToken();
    const [header, , signature] = token.split(".");
    const forgedClaims = Buffer.from(JSON.stringify({ ...decodeJwt(token), sub: "someone-else" }));
    const forged = [header, forgedClaims.toString("base64url"), signature].join(".");

    await expect(new AccessTokenVerifier(testAuthOptions()).verify(forged)).rejects.toThrow(InvalidAccessTokenError);
  });

  it("refuses something that is not a token", async () => {
    await expect(new AccessTokenVerifier(testAuthOptions()).verify("not-a-token")).rejects.toThrow(
      InvalidAccessTokenError,
    );
  });

  it("blames itself, not the caller, when it cannot fetch the signing keys", async () => {
    const token = await issueAccessToken();
    // Nothing listens on port 9, so fetching the keys fails.
    const verifier = new AccessTokenVerifier({ ...testAuthOptions(), jwksUrl: "http://127.0.0.1:9/certs" });

    await expect(verifier.verify(token)).rejects.toThrow(TokenIssuerUnavailableError);
  });
});
