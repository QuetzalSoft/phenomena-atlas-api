import { loadDatabaseUrl } from "./configs/app.config.js";
import { createDatabase } from "./libs/db/database.js";
import { createHandler, loadMarginSeconds } from "./modules/phenomenon/commands/recompute-due-indexes/recompute-due-indexes.lambda.js";

// The Lambda function that EventBridge Scheduler invokes once a minute (ADR 0017 in the system
// repository). The database is created when the module loads, so that its connection outlives
// one invocation; one connection is enough, as a function instance handles one at a time.
//
// TODO(hosting): connect to RDS with IAM authentication instead of a DATABASE_URL with a
// password. It needs the AWS environment, which does not exist yet.
const db = createDatabase(loadDatabaseUrl(), { maxConnections: 1 });

export const handler = createHandler(db, { marginSeconds: loadMarginSeconds() });
