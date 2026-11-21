import type { NestExpressApplication } from "@nestjs/platform-express";
import { decodeJwt } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "../src/libs/api/contract.js";
import { signInAs } from "./support/accounts.js";
import { startTestApp } from "./support/app.js";
import { issueAccessToken, type TestUsername, testUserProfile } from "./support/keycloak.js";

// Each person here is used by this spec only: lena edits her own details, mike is edited by
// an admin, nina is refused, oscar keeps using a token issued before his edit, quinn is an
// analyst whose edit hits a broken identity provider, and olga is the admin.
describe("editing account details", () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const myAccount = async (token: string) =>
    (await http().get("/accounts/me").auth(token, { type: "bearer" }).expect(200)).body as Schemas["Account"];
  const editOwn = (token: string, body: unknown) => http().put("/accounts/me/profile").auth(token, { type: "bearer" }).send(body as object);
  const editOf = (token: string, accountId: string, body: unknown) =>
    http().put(`/accounts/${accountId}/profile`).auth(token, { type: "bearer" }).send(body as object);
  const newDetails = (username: TestUsername): Schemas["AccountProfile"] => ({
    firstName: `${testUserProfile(username).firstName}-edited`,
    lastName: "Renamed",
    email: `${username}.edited@tests.phenomena-atlas.local`,
  });
  const expectedAccount = (details: Schemas["AccountProfile"]) => ({
    firstName: details.firstName,
    lastName: details.lastName,
    name: `${details.firstName} ${details.lastName}`,
    email: details.email,
  });
  /** What Keycloak now holds for the person, as a token issued after the edit shows it. */
  const keycloakClaims = async (username: TestUsername) => {
    const claims = decodeJwt(await issueAccessToken({ username }));
    return { firstName: claims.given_name, lastName: claims.family_name, name: claims.name, email: claims.email };
  };

  describe("one's own details", () => {
    it("needs an access token", async () => {
      const response = await http().put("/accounts/me/profile").send(newDetails("lena")).expect(401);

      expect(response.body).toMatchObject({ code: "unauthorized" });
    });

    it("changes the first name, last name and email in the answer, the account and Keycloak", async () => {
      const token = await signInAs("lena", "user");
      await myAccount(token);
      const details = newDetails("lena");

      const response = await editOwn(token, details).expect(200);

      expect(response.body).toMatchObject({ username: "lena", role: "user", ...expectedAccount(details) });
      expect(await myAccount(token)).toMatchObject(expectedAccount(details));
      expect(await keycloakClaims("lena")).toEqual(expectedAccount(details));
      // Signing in again, with the details Keycloak now holds, shows the same account.
      expect(await myAccount(await issueAccessToken({ username: "lena" }))).toEqual(response.body);
    });

    it("refuses values outside the limits of the request body, before anything is written", async () => {
      const token = await signInAs("nina", "user");
      const before = await myAccount(token);

      for (const body of [
        { ...newDetails("nina"), firstName: "" },
        { ...newDetails("nina"), lastName: "x".repeat(101) },
        { ...newDetails("nina"), email: "not-an-email" },
        { firstName: "Nina", lastName: "Tester" },
      ]) {
        const response = await editOwn(token, body).expect(400);
        expect(response.body).toMatchObject({ code: "invalid_request" });
      }
      expect(await myAccount(token)).toEqual(before);
    });

    it("refuses an email another account has, and changes nothing", async () => {
      const token = await signInAs("nina", "user");
      const before = await myAccount(token);
      const claimsBefore = await keycloakClaims("nina");

      const response = await editOwn(token, { ...newDetails("nina"), email: testUserProfile("alice").email }).expect(409);

      expect(response.body).toMatchObject({ code: "email_already_in_use" });
      expect(await myAccount(token)).toEqual(before);
      expect(await keycloakClaims("nina")).toEqual(claimsBefore);
    });

    it("refuses a value Keycloak does not accept, and changes nothing", async () => {
      const token = await signInAs("nina", "user");
      const before = await myAccount(token);
      const claimsBefore = await keycloakClaims("nina");

      const response = await editOwn(token, { ...newDetails("nina"), firstName: "Nina<b>" }).expect(400);

      expect(response.body).toMatchObject({ code: "invalid_account_details" });
      expect(await myAccount(token)).toEqual(before);
      expect(await keycloakClaims("nina")).toEqual(claimsBefore);
    });

    it("says so when Keycloak cannot be used, and changes nothing", async () => {
      const token = await signInAs("quinn", "analyst");
      const before = await myAccount(token);
      const brokenApp = await startTestApp({ KEYCLOAK_ADMIN_CLIENT_SECRET: "not-the-secret" });
      try {
        const response = await request(brokenApp.getHttpServer())
          .put("/accounts/me/profile")
          .auth(token, { type: "bearer" })
          .send(newDetails("quinn"))
          .expect(503);

        expect(response.body).toMatchObject({ code: "account_update_unavailable" });
      } finally {
        await brokenApp.close();
      }
      expect(await myAccount(token)).toEqual(before);
      expect(await keycloakClaims("quinn")).toMatchObject({ email: testUserProfile("quinn").email });
    });

    it("is not undone by a token issued before the edit", async () => {
      const oldToken = await signInAs("oscar", "user");
      await myAccount(oldToken);
      const details = newDetails("oscar");

      await editOwn(oldToken, details).expect(200);

      // The old token still carries the old details. The account must not go back to them.
      expect(await myAccount(oldToken)).toMatchObject(expectedAccount(details));
      expect(await myAccount(await issueAccessToken({ username: "oscar" }))).toMatchObject(expectedAccount(details));
    });
  });

  describe("another account's details", () => {
    it("is changed by an admin", async () => {
      const admin = await signInAs("olga", "admin");
      const oldToken = await signInAs("mike", "user");
      const mike = await myAccount(oldToken);
      const details = newDetails("mike");

      const response = await editOf(admin, mike.id, details).expect(200);

      expect(response.body).toMatchObject({ id: mike.id, username: "mike", role: "user", ...expectedAccount(details) });
      expect(await keycloakClaims("mike")).toEqual(expectedAccount(details));
      // Mike's token predates the edit, so it does not undo it either.
      expect(await myAccount(oldToken)).toMatchObject(expectedAccount(details));
      expect(await myAccount(await issueAccessToken({ username: "mike" }))).toMatchObject(expectedAccount(details));
    });

    it("is refused to users and analysts", async () => {
      const mike = await myAccount(await issueAccessToken({ username: "mike" }));

      for (const token of [await signInAs("nina", "user"), await signInAs("quinn", "analyst")]) {
        const response = await editOf(token, mike.id, newDetails("mike")).expect(403);
        expect(response.body).toMatchObject({ code: "forbidden" });
      }
    });

    it("answers 404 for an account that does not exist", async () => {
      const admin = await signInAs("olga", "admin");

      const response = await editOf(admin, "00000000-0000-4000-8000-0000000000ff", newDetails("mike")).expect(404);

      expect(response.body).toMatchObject({ code: "account_not_found" });
    });
  });
});
