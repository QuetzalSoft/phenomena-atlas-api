import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/libs/db/database.js";
import { TransactionManager } from "../src/libs/db/transaction-manager.js";
import { ChangePhenomenonStatusCommand } from "../src/modules/phenomenon/commands/change-phenomenon-status/change-phenomenon-status.command.js";
import { ChangePhenomenonStatusService } from "../src/modules/phenomenon/commands/change-phenomenon-status/change-phenomenon-status.service.js";
import { recomputeDueIndexes } from "../src/modules/phenomenon/commands/recompute-due-indexes/recompute-due-indexes.js";
import { createHandler } from "../src/modules/phenomenon/commands/recompute-due-indexes/recompute-due-indexes.lambda.js";
import { PhenomenonIndexCalculator, phenomenonIndexLockSpace } from "../src/modules/phenomenon/database/phenomenon-index.calculator.js";
import { PhenomenonRepository } from "../src/modules/phenomenon/database/phenomenon.repository.js";
import { createIsolatedDatabase } from "./support/database.js";
import { computationOf, count, createAuthor, fileReports, indexOf, insertPhenomenon, of, seedPartition } from "./support/phenomenon-index.js";

// Each describe has a database of its own with its own partition: which phenomena are due
// depends on every phenomenon in the database, and the shared one has no fixed partition.

/** A database of its own, with the partition of support/phenomenon-index.ts and a report author. */
async function isolated(name: string) {
  const url = await createIsolatedDatabase(name);
  const db = createDatabase(url);
  await seedPartition(db);
  return { url, db, author: await createAuthor(db), calculator: new PhenomenonIndexCalculator(new TransactionManager(db)) };
}

/** A logger that keeps what it is told. */
function recordingLogger() {
  const logged: string[] = [];
  const errors: string[] = [];
  return { logged, errors, log: (message: string) => logged.push(message), error: (message: string) => errors.push(message) };
}

/** Holds the phenomenon's index lock from another connection until `release` is called. */
async function holdLock(db: Kysely<Database>, phenomenonId: number) {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked = () => {};
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const holder = db.transaction().execute(async (transaction) => {
    await sql`SELECT pg_advisory_xact_lock(${phenomenonIndexLockSpace}::integer, ${phenomenonId}::integer)`.execute(transaction);
    locked();
    await released;
  });
  await isLocked;
  return async () => {
    release();
    await holder;
  };
}

/** Moves the last computation back in time, as if it had run that many minutes ago. */
const computedMinutesAgo = (db: Kysely<Database>, phenomenonId: number, minutes: number) =>
  sql`UPDATE phenomenon_index_computation SET computed_at = now() - make_interval(mins => ${minutes}::integer) WHERE phenomenon_id = ${phenomenonId}`.execute(db);

describe("which phenomena are due", () => {
  let db: Kysely<Database>;
  let calculator: PhenomenonIndexCalculator;

  beforeAll(async () => {
    ({ db, calculator } = await isolated("index_due"));
  });

  afterAll(async () => {
    await db.destroy();
  });

  const computed = async () => {
    const id = await insertPhenomenon(db, count);
    await calculator.recompute(id, { wait: true });
    return id;
  };

  it("includes a published phenomenon that was never computed", async () => {
    const id = await insertPhenomenon(db, count);
    expect(await calculator.findDue()).toContain(id);
  });

  it("leaves out one computed within its refresh interval", async () => {
    const id = await computed();
    expect(await calculator.findDue()).not.toContain(id);
  });

  it("includes one whose refresh interval has elapsed since its last computation", async () => {
    const id = await computed();
    await computedMinutesAgo(db, id, 61);
    expect(await calculator.findDue()).toContain(id);
  });

  it("includes one whose revision changed since its last computation", async () => {
    const id = await computed();
    await sql`UPDATE phenomenon SET revision = revision + 1 WHERE id = ${id}`.execute(db);
    expect(await calculator.findDue()).toContain(id);
  });

  it("never includes a draft or an archived phenomenon", async () => {
    const draft = await insertPhenomenon(db, count, { status: "draft" });
    const archived = await insertPhenomenon(db, count, { status: "archived" });
    const due = await calculator.findDue();
    expect(due).not.toContain(draft);
    expect(due).not.toContain(archived);
  });

  it("puts the never computed first, then the most overdue", async () => {
    const never = await insertPhenomenon(db, count);
    const longOverdue = await computed();
    await computedMinutesAgo(db, longOverdue, 180);
    const justOverdue = await computed();
    await computedMinutesAgo(db, justOverdue, 61);
    // Due because it changed, though its interval has not elapsed: the least overdue.
    const changed = await computed();
    await sql`UPDATE phenomenon SET revision = revision + 1 WHERE id = ${changed}`.execute(db);

    const ours = new Set([never, longOverdue, justOverdue, changed]);
    expect((await calculator.findDue()).filter((id) => ours.has(id))).toEqual([never, longOverdue, justOverdue, changed]);
  });

  // Last: a new partition version makes every phenomenon in this database due.
  it("includes one computed before the latest partition version", async () => {
    const id = await computed();
    expect(await calculator.findDue()).not.toContain(id);

    await sql`INSERT INTO partition_version (number) VALUES (2)`.execute(db);

    expect(await calculator.findDue()).toContain(id);
  });
});

describe("a tick", () => {
  let url: string;
  let db: Kysely<Database>;
  let author: string;
  let calculator: PhenomenonIndexCalculator;

  beforeAll(async () => {
    ({ url, db, author, calculator } = await isolated("index_tick"));
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("computes every phenomenon that is due, and logs nothing when nothing is", async () => {
    const first = await insertPhenomenon(db, count);
    const second = await insertPhenomenon(db, count);
    await fileReports(db, author, first, [[1, {}]]);
    const logger = recordingLogger();

    expect(await recomputeDueIndexes(calculator, { logger })).toEqual({ computed: 2, skipped: 0, failed: 0 });
    expect(await indexOf(db, first)).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0 });
    expect(await computationOf(db, second)).toBeDefined();
    expect(logger.logged).toEqual(["Index tick: 2 computed, 0 skipped, 0 failed."]);

    expect(await recomputeDueIndexes(calculator, { logger })).toEqual({ computed: 0, skipped: 0, failed: 0 });
    expect(logger.logged).toHaveLength(1);
  });

  it("logs a failure with the phenomenon's id and goes on with the rest", async () => {
    const failing = await insertPhenomenon(db, of("sum", "victims"));
    const fine = await insertPhenomenon(db, count);
    await fileReports(db, author, failing, [[1, { victims: "many" }]]);
    const logger = recordingLogger();

    try {
      expect(await recomputeDueIndexes(calculator, { logger })).toEqual({ computed: 1, skipped: 0, failed: 1 });
      expect(logger.errors).toEqual([expect.stringContaining(`phenomenon ${failing} failed`)]);
      expect(await computationOf(db, failing)).toBeUndefined();
      expect(await computationOf(db, fine)).toBeDefined();
      expect(await calculator.findDue()).toEqual([failing]);
    } finally {
      // Out of the way of the tests below, where it would fail again.
      await sql`UPDATE phenomenon SET status = 'archived' WHERE id = ${failing}`.execute(db);
    }
  });

  it("starts nothing once its deadline has passed, leaving the rest due", async () => {
    const id = await insertPhenomenon(db, count);

    expect(await recomputeDueIndexes(calculator, { deadline: Date.now() - 1, logger: recordingLogger() })).toEqual({ computed: 0, skipped: 0, failed: 0 });
    expect(await computationOf(db, id)).toBeUndefined();
    expect(await calculator.findDue()).toEqual([id]);

    await calculator.recompute(id, { wait: true });
  });

  it("skips a phenomenon whose computation is under way elsewhere", async () => {
    const id = await insertPhenomenon(db, count);
    const other = createDatabase(url);
    const release = await holdLock(other, id);
    try {
      expect(await recomputeDueIndexes(calculator, { logger: recordingLogger() })).toEqual({ computed: 0, skipped: 1, failed: 0 });
      expect(await computationOf(db, id)).toBeUndefined();
    } finally {
      await release();
      await other.destroy();
    }

    expect(await recomputeDueIndexes(calculator, { logger: recordingLogger() })).toEqual({ computed: 1, skipped: 0, failed: 0 });
  });
});

describe("publishing a phenomenon", () => {
  let db: Kysely<Database>;
  let author: string;
  let service: ChangePhenomenonStatusService;

  beforeAll(async () => {
    ({ db, author } = await isolated("index_publish"));
    // One manager for both, as the application injects: the calculator joins the transaction
    // the service opens only through the manager that opened it.
    const transactions = new TransactionManager(db);
    service = new ChangePhenomenonStatusService(new PhenomenonRepository(transactions), new PhenomenonIndexCalculator(transactions));
  });

  afterAll(async () => {
    await db.destroy();
  });

  const changeStatus = (id: number, baseRevision: number, status: "published" | "archived") =>
    service.execute(new ChangePhenomenonStatusCommand(id, baseRevision, status));
  const stateOf = (id: number) => db.selectFrom("phenomenon").select(["status", "revision"]).where("id", "=", id).executeTakeFirstOrThrow();

  it("computes its index in the same transaction", async () => {
    const id = await insertPhenomenon(db, count, { status: "draft", revision: 1 });
    await fileReports(db, author, id, [
      [1, {}],
      [3, {}],
    ]);

    expect((await changeStatus(id, 1, "published")).isOk()).toBe(true);

    expect(await indexOf(db, id)).toEqual({ 1: 1, 2: 0, 3: 1, 4: 0 });
    expect(await computationOf(db, id)).toMatchObject({ phenomenon_revision: 2, partition_version: 1 });
  });

  it("leaves the phenomenon a draft when the computation fails", async () => {
    const id = await insertPhenomenon(db, of("sum", "victims"), { status: "draft", revision: 1 });
    await fileReports(db, author, id, [[1, { victims: "many" }]]);

    await expect(changeStatus(id, 1, "published")).rejects.toThrow(/double precision/);

    expect(await stateOf(id)).toEqual({ status: "draft", revision: 1 });
    expect(await computationOf(db, id)).toBeUndefined();
  });

  it("does not compute when archiving, and computes again when publishing again", async () => {
    const id = await insertPhenomenon(db, count, { status: "draft", revision: 1 });
    await changeStatus(id, 1, "published");
    const published = await computationOf(db, id);
    await fileReports(db, author, id, [[2, {}]]);

    expect((await changeStatus(id, 2, "archived")).isOk()).toBe(true);
    expect(await computationOf(db, id)).toEqual(published);
    expect(await indexOf(db, id)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });

    expect((await changeStatus(id, 3, "published")).isOk()).toBe(true);
    expect(await computationOf(db, id)).toMatchObject({ phenomenon_revision: 4 });
    expect(await indexOf(db, id)).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0 });
  });
});

describe("the Lambda handler", () => {
  let db: Kysely<Database>;

  beforeAll(async () => {
    ({ db } = await isolated("index_handler"));
  });

  afterAll(async () => {
    await db.destroy();
  });

  const contextWith = (remainingMs: number) => ({ getRemainingTimeInMillis: () => remainingMs });

  it("runs one tick and returns its summary, starting nothing within the margin before the timeout", async () => {
    const id = await insertPhenomenon(db, count);
    const handler = createHandler(db, { marginSeconds: 60, logger: recordingLogger() });

    // 30 seconds left is inside the 60-second margin.
    expect(await handler({}, contextWith(30_000))).toEqual({ computed: 0, skipped: 0, failed: 0 });
    expect(await computationOf(db, id)).toBeUndefined();

    expect(await handler({}, contextWith(300_000))).toEqual({ computed: 1, skipped: 0, failed: 0 });
    expect(await computationOf(db, id)).toBeDefined();
  });
});
