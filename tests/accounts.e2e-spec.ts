import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "../src/libs/api/contract.js";
import { signInAs } from "./support/accounts.js";
import { startTestApp } from "./support/app.js";
import { issueAccessToken, testUserProfile } from "./support/keycloak.js";

// Each person here is used by this spec only: alice stays a user, bob is the one whose role
// changes, carol is an analyst and dave an admin.
describe("accounts", () => {
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

  describe("the caller's own account", () => {
    it("needs an access token", async () => {
      const response = await http().get("/accounts/me").expect(401);

      expect(response.body).toMatchObject({ code: "unauthorized" });
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    });

    it("is created as a user on the first call, with the profile from the token", async () => {
      const token = await issueAccessToken({ username: "alice" });
      const { email } = testUserProfile("alice");

      const account = await myAccount(token);

      expect(account).toEqual({
        id: expect.any(String) as string,
        username: "alice",
        name: "Alice Tester",
        email,
        role: "user",
        createdAt: expect.any(String) as string,
      });
      expect(await myAccount(token)).toEqual(account);
    });
  });

  describe("listing accounts", () => {
    it("is refused to users and analysts", async () => {
      for (const token of [await signInAs("alice", "user"), await signInAs("carol", "analyst")]) {
        const response = await http().get("/accounts").auth(token, { type: "bearer" }).expect(403);
        expect(response.body).toMatchObject({ code: "forbidden" });
      }
    });

    it("pages through every account, oldest first, for an admin", async () => {
      const admin = await signInAs("dave", "admin");
      const alice = await myAccount(await issueAccessToken({ username: "alice" }));

      const seen: Schemas["Account"][] = [];
      let cursor: string | undefined;
      do {
        const response = await http()
          .get("/accounts")
          .query({ limit: 2, ...(cursor && { cursor }) })
          .auth(admin, { type: "bearer" })
          .expect(200);
        const page = response.body as Schemas["AccountPage"];
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);

      expect(new Set(seen.map((account) => account.id)).size).toBe(seen.length);
      expect(seen.map((account) => account.createdAt)).toEqual(seen.map((account) => account.createdAt).sort());
      expect(seen).toContainEqual(alice);
      expect(seen.find((account) => account.username === "dave")?.role).toBe("admin");
    });

    it("refuses a cursor the API did not issue", async () => {
      const admin = await signInAs("dave", "admin");

      const response = await http()
        .get("/accounts")
        .query({ cursor: "not-a-cursor" })
        .auth(admin, { type: "bearer" })
        .expect(400);

      expect(response.body).toMatchObject({ code: "invalid_cursor" });
    });

    it("refuses a page size outside the contract's range", async () => {
      const admin = await signInAs("dave", "admin");

      await http().get("/accounts").query({ limit: 0 }).auth(admin, { type: "bearer" }).expect(400);
      await http().get("/accounts").query({ limit: 201 }).auth(admin, { type: "bearer" }).expect(400);
    });
  });

  describe("changing a role", () => {
    const changeRole = (token: string, accountId: string, role: string) =>
      http().put(`/accounts/${accountId}/role`).auth(token, { type: "bearer" }).send({ role });

    it("lets an admin promote someone, effective on their next request", async () => {
      const admin = await signInAs("dave", "admin");
      const bobToken = await signInAs("bob", "user");
      const bob = await myAccount(bobToken);

      const response = await changeRole(admin, bob.id, "analyst").expect(200);

      expect(response.body).toEqual({ ...bob, role: "analyst" });
      expect((await myAccount(bobToken)).role).toBe("analyst");
      await http().get("/accounts").auth(bobToken, { type: "bearer" }).expect(403);

      await changeRole(admin, bob.id, "admin").expect(200);
      await http().get("/accounts").auth(bobToken, { type: "bearer" }).expect(200);

      await changeRole(admin, bob.id, "user").expect(200);
      expect((await myAccount(bobToken)).role).toBe("user");
    });

    it("does not let an admin change their own role", async () => {
      const admin = await signInAs("dave", "admin");
      const dave = await myAccount(admin);

      const response = await changeRole(admin, dave.id, "user").expect(403);

      expect(response.body).toMatchObject({ code: "own_role_change_forbidden" });
      expect((await myAccount(admin)).role).toBe("admin");
    });

    it("is refused to users and analysts", async () => {
      const alice = await myAccount(await signInAs("alice", "user"));

      for (const token of [await signInAs("alice", "user"), await signInAs("carol", "analyst")]) {
        const response = await changeRole(token, alice.id, "admin").expect(403);
        expect(response.body).toMatchObject({ code: "forbidden" });
      }
      expect((await myAccount(await issueAccessToken({ username: "alice" }))).role).toBe("user");
    });

    it("answers 404 for an account that does not exist", async () => {
      const admin = await signInAs("dave", "admin");

      const response = await changeRole(admin, "00000000-0000-4000-8000-000000000000", "analyst").expect(404);

      expect(response.body).toMatchObject({ code: "account_not_found" });
    });

    it("refuses a role that does not exist", async () => {
      const admin = await signInAs("dave", "admin");
      const alice = await myAccount(await issueAccessToken({ username: "alice" }));

      await changeRole(admin, alice.id, "superuser").expect(400);
    });
  });
});
