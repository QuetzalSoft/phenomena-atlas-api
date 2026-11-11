import { randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import { sql } from "kysely";
import { inject } from "vitest";
import { createDatabase } from "../../src/libs/db/database.js";
import { TransactionManager } from "../../src/libs/db/transaction-manager.js";
import { setRoleByOperator } from "../../src/modules/account/commands/set-role-by-operator/set-role-by-operator.js";
import { AccountRepository } from "../../src/modules/account/database/account.repository.js";
import type { Role } from "../../src/modules/account/domain/role.js";
import { issueAccessToken, type TestUsername } from "./keycloak.js";

/** Signs in as a test user, gives them `role` the way an operator would, and returns their token. */
export async function signInAs(username: TestUsername, role: Role): Promise<string> {
  const token = await issueAccessToken({ username });
  const subject = decodeJwt(token).sub as string;
  const db = createDatabase(inject("databaseUrl"));
  try {
    await setRoleByOperator(new AccountRepository(new TransactionManager(db)), { subject }, role);
  } finally {
    await db.destroy();
  }
  return token;
}

export interface StoredAccount {
  username: string;
  name?: string;
  email?: string;
  role: Role;
  createdAt: string;
}

/**
 * Stores accounts directly, with a chosen creation time, as if those people had signed in
 * then. The API sets created_at itself, so only a test can backdate an account.
 */
export async function storeAccounts(accounts: StoredAccount[]): Promise<void> {
  const db = createDatabase(inject("databaseUrl"));
  try {
    for (const account of accounts) {
      await sql`
        INSERT INTO account (subject, username, name, email, role, created_at)
        VALUES (${randomUUID()}, ${account.username}, ${account.name ?? null}, ${account.email ?? null},
                ${account.role}, ${account.createdAt}::timestamptz)
      `.execute(db);
    }
  } finally {
    await db.destroy();
  }
}
