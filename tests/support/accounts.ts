import { decodeJwt } from "jose";
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
