import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "../src/libs/api/contract.js";
import { signInAs, storeAccounts } from "./support/accounts.js";
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

  describe("filtering accounts", () => {
    // Every account here carries this marker, so searching for it leaves out the accounts
    // other specs create. They are dated 2001, long before any of those.
    const marker = `flt${Date.now().toString(36)}`;
    const stored = [
      { username: `${marker}-ana`, name: "Ana Pérez", email: `ana.${marker}@example.test`, role: "user", createdAt: "2001-01-01T00:00:00.000Z" },
      { username: `${marker}-andrés`, name: "Andrés Soto", email: `andres.${marker}@example.test`, role: "analyst", createdAt: "2001-01-15T12:00:00.000Z" },
      { username: `${marker}-ari`, name: "Ari 100%_Real", email: `ari.${marker}@example.test`, role: "analyst", createdAt: "2001-02-01T00:00:00.000Z" },
      { username: `${marker}-bea`, name: "Bea Ramos", email: `bea.${marker}@example.test`, role: "admin", createdAt: "2001-02-10T08:30:00.000Z" },
      { username: `${marker}-ben`, name: "Ben Ito", email: `ben.${marker}@example.test`, role: "analyst", createdAt: "2001-03-01T00:00:00.000Z" },
    ] as const;
    let admin: string;

    beforeAll(async () => {
      admin = await signInAs("dave", "admin");
      await storeAccounts([...stored]);
    });

    /** Every page of the filtered list, as usernames. */
    const list = async (filters: Record<string, string>, limit = 50) => {
      const usernames: string[] = [];
      let cursor: string | undefined;
      do {
        const response = await http()
          .get("/accounts")
          .query({ limit, ...filters, ...(cursor && { cursor }) })
          .auth(admin, { type: "bearer" })
          .expect(200);
        const page = response.body as Schemas["AccountPage"];
        usernames.push(...page.items.map((account) => account.username ?? ""));
        cursor = page.nextCursor;
      } while (cursor);
      return usernames;
    };
    const names = (...suffixes: string[]) => suffixes.map((suffix) => `${marker}-${suffix}`);

    it("finds text in the username, the name or the email, ignoring case", async () => {
      expect(await list({ q: marker.toUpperCase() })).toEqual(names("ana", "andrés", "ari", "bea", "ben"));
      expect(await list({ q: `${marker}-B` })).toEqual(names("bea", "ben"));
      expect(await list({ q: "RAMOS" })).toContain(`${marker}-bea`);
      expect(await list({ q: `andres.${marker}` })).toEqual(names("andrés"));
    });

    it("takes % and _ in the text literally", async () => {
      expect(await list({ q: "100%_Real" })).toEqual(names("ari"));
      expect(await list({ q: `${marker}%` })).toEqual([]);
      expect(await list({ q: `${marker}_` })).toEqual([]);
    });

    it("filters by role", async () => {
      expect(await list({ q: marker, role: "analyst" })).toEqual(names("andrés", "ari", "ben"));
      expect(await list({ q: marker, role: "admin" })).toEqual(names("bea"));
    });

    it("filters by a half-open creation range", async () => {
      expect(await list({ q: marker, createdFrom: "2001-01-15T12:00:00.000Z" })).toEqual(names("andrés", "ari", "bea", "ben"));
      expect(await list({ q: marker, createdBefore: "2001-02-01T00:00:00.000Z" })).toEqual(names("ana", "andrés"));
      expect(
        await list({ q: marker, createdFrom: "2001-01-02T00:00:00.000Z", createdBefore: "2001-03-01T00:00:00.000Z" }),
      ).toEqual(names("andrés", "ari", "bea"));
    });

    it("combines every filter", async () => {
      const filters = {
        q: `${marker}-a`,
        role: "analyst",
        createdFrom: "2001-01-10T00:00:00.000Z",
        createdBefore: "2001-02-15T00:00:00.000Z",
      };
      expect(await list(filters)).toEqual(names("andrés", "ari"));
    });

    it("pages through a filtered list with no duplicates or gaps", async () => {
      expect(await list({ q: marker }, 2)).toEqual(names("ana", "andrés", "ari", "bea", "ben"));
      expect(await list({ q: marker, role: "analyst" }, 1)).toEqual(names("andrés", "ari", "ben"));
    });

    it("refuses an empty or inverted creation range", async () => {
      for (const range of [
        { createdFrom: "2001-02-01T00:00:00.000Z", createdBefore: "2001-01-01T00:00:00.000Z" },
        { createdFrom: "2001-02-01T00:00:00.000Z", createdBefore: "2001-02-01T00:00:00.000Z" },
      ]) {
        const response = await http().get("/accounts").query(range).auth(admin, { type: "bearer" }).expect(400);
        expect(response.body).toMatchObject({ code: "invalid_date_range" });
      }
    });

    it("refuses filters that do not match the contract", async () => {
      for (const filters of [{ role: "superuser" }, { q: "" }, { q: "x".repeat(101) }, { createdFrom: "yesterday" }]) {
        await http().get("/accounts").query(filters).auth(admin, { type: "bearer" }).expect(400);
      }
    });

    it("is refused to users and analysts", async () => {
      const response = await http()
        .get("/accounts")
        .query({ q: marker })
        .auth(await signInAs("carol", "analyst"), { type: "bearer" })
        .expect(403);
      expect(response.body).toMatchObject({ code: "forbidden" });
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
