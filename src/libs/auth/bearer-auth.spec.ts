import { decodeJwt } from "jose";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { issueAccessToken, testAuthOptions } from "../../../tests/support/keycloak.js";
import { AccessTokenVerifier, InvalidAccessTokenError } from "./access-token-verifier.js";
import { type AuthenticatedRequest, bearerAuth } from "./bearer-auth.js";

const requestWith = (authorization?: string) => ({ headers: { authorization } }) as Request;

describe("bearerAuth", () => {
  const handler = () => bearerAuth(new AccessTokenVerifier(testAuthOptions()));

  it("lets a valid token through and records who sent it", async () => {
    const token = await issueAccessToken();
    const request = requestWith(`Bearer ${token}`);

    await expect(handler()(request)).resolves.toBe(true);
    expect((request as AuthenticatedRequest).principal).toEqual({ subject: decodeJwt(token).sub });
  });

  it("refuses a request without a bearer token", async () => {
    await expect(handler()(requestWith())).rejects.toThrow(InvalidAccessTokenError);
    await expect(handler()(requestWith("Basic ZGV2OmRldg=="))).rejects.toThrow(InvalidAccessTokenError);
  });

  it("refuses an invalid token", async () => {
    await expect(handler()(requestWith("Bearer not-a-token"))).rejects.toThrow(InvalidAccessTokenError);
  });
});
