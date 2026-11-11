import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "./database.js";
import { TransactionManager } from "./transaction-manager.js";

type Probe = {
  transaction_probe: { label: string };
};

describe("TransactionManager", () => {
  let db: Kysely<Database>;
  let transactions: TransactionManager;

  const insert = (label: string) =>
    transactions.connection.withTables<Probe>().insertInto("transaction_probe").values({ label }).execute();

  const labels = async () => {
    const rows = await db.withTables<Probe>().selectFrom("transaction_probe").select("label").execute();
    return rows.map((row) => row.label).sort();
  };

  beforeAll(async () => {
    db = createDatabase(inject("databaseUrl"));
    transactions = new TransactionManager(db);
    await sql`CREATE TABLE transaction_probe (label text NOT NULL)`.execute(db);
  });

  afterAll(async () => {
    await sql`DROP TABLE transaction_probe`.execute(db);
    await db.destroy();
  });

  beforeEach(async () => {
    await sql`TRUNCATE transaction_probe`.execute(db);
  });

  it("commits every write when the work resolves", async () => {
    await transactions.run(async () => {
      await insert("first");
      await insert("second");
    });

    expect(await labels()).toEqual(["first", "second"]);
  });

  it("rolls back every write when the work throws", async () => {
    const failure = transactions.run(async () => {
      await insert("first");
      throw new Error("business rule broken");
    });

    await expect(failure).rejects.toThrow("business rule broken");
    expect(await labels()).toEqual([]);
  });

  it("joins the open transaction when run again inside it", async () => {
    const failure = transactions.run(async () => {
      await transactions.run(() => insert("inner"));
      throw new Error("outer failed");
    });

    await expect(failure).rejects.toThrow("outer failed");
    expect(await labels()).toEqual([]);
  });

  it("keeps concurrent transactions apart", async () => {
    const failure = transactions.run(async () => {
      await insert("failed");
      throw new Error("failed");
    });
    const success = transactions.run(() => insert("committed"));

    await Promise.allSettled([failure, success]);
    expect(await labels()).toEqual(["committed"]);
  });

  it("writes through the pool outside a transaction", async () => {
    await insert("autocommit");

    expect(await labels()).toEqual(["autocommit"]);
  });
});
