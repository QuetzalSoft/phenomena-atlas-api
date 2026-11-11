import { Logger } from "@nestjs/common";
import { loadDatabaseUrl } from "./configs/app.config.js";
import { createDatabase } from "./libs/db/database.js";
import { TransactionManager } from "./libs/db/transaction-manager.js";
import {
  type OperatorTarget,
  OperatorTargetError,
  setRoleByOperator,
} from "./modules/account/commands/set-role-by-operator/set-role-by-operator.js";
import { AccountRepository } from "./modules/account/database/account.repository.js";
import { isRole, roles } from "./modules/account/domain/role.js";

// Sets an account's role: `set-role <email | identity provider user id> <role>`.
const logger = new Logger("Accounts");
const [who, role] = process.argv.slice(2);
if (!who || !isRole(role)) {
  logger.error(`Usage: set-role <email | identity provider user id> <${roles.join(" | ")}>`);
  process.exit(1);
}
const target: OperatorTarget = who.includes("@") ? { email: who } : { subject: who };

const db = createDatabase(loadDatabaseUrl());
try {
  const { account, created } = await setRoleByOperator(new AccountRepository(new TransactionManager(db)), target, role);
  if (created) {
    logger.warn(`No account had the identity provider id ${who}, so one was created. Check the id if nobody signs in with it.`);
  }
  logger.log(`Account ${account.id} now has the role ${account.role}.`);
} catch (error) {
  // A mistake in the arguments, not a failure: say what is wrong without a stack trace.
  if (!(error instanceof OperatorTargetError)) {
    throw error;
  }
  logger.error(error.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
