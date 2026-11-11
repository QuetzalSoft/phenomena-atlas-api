import { decodeJwt } from "jose";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "../src/libs/db/database.js";
import { TransactionManager } from "../src/libs/db/transaction-manager.js";
import {
  OperatorTargetError,
  setRoleByOperator,
} from "../src/modules/account/commands/set-role-by-operator/set-role-by-operator.js";
import { AccountRepository } from "../src/modules/account/database/account.repository.js";
import { issueAccessToken, testUserProfile } from "./support/keycloak.js";

// erin and frank are used by this spec only.
describe("setting a role from the command line", () => {
  let db: Kysely<Database>;
  let accounts: AccountRepository;

  beforeAll(() => {
    db = createDatabase(inject("databaseUrl"));
    accounts = new AccountRepository(new TransactionManager(db));
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("makes an admin of someone who has never called the API, by their identity provider id", async () => {
    const subject = decodeJwt(await issueAccessToken({ username: "erin" })).sub as string;

    const { account, created } = await setRoleByOperator(accounts, { subject }, "admin");

    expect(created).toBe(true);
    expect(account.role).toBe("admin");
    const ensured = await accounts.ensureForPrincipal({ subject, username: "erin" });
    expect(ensured.id).toBe(account.id);
    expect(ensured.role).toBe("admin");
  });

  it("can take an admin's own role away, to recover from a mistake", async () => {
    const subject = decodeJwt(await issueAccessToken({ username: "erin" })).sub as string;
    await setRoleByOperator(accounts, { subject }, "admin");

    const { account, created } = await setRoleByOperator(accounts, { subject }, "user");

    expect(created).toBe(false);
    expect(account.role).toBe("user");
  });

  it("finds an existing account by email, ignoring case", async () => {
    const { email } = testUserProfile("frank");
    const subject = decodeJwt(await issueAccessToken({ username: "frank" })).sub as string;
    await accounts.ensureForPrincipal({ subject, username: "frank", email });

    const { account } = await setRoleByOperator(accounts, { email: email.toUpperCase() }, "analyst");

    expect(account.toProps()).toMatchObject({ subject, role: "analyst" });
  });

  it("refuses an email no account has", async () => {
    await expect(setRoleByOperator(accounts, { email: "nobody@tests.phenomena-atlas.local" }, "admin")).rejects.toThrow(
      OperatorTargetError,
    );
  });
});
