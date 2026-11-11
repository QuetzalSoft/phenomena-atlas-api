import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { Principal } from "../../../libs/auth/access-token-verifier.js";
import { TransactionManager } from "../../../libs/db/transaction-manager.js";
import { accountFromRow } from "../account.mapper.js";
import type { Account } from "../domain/account.entity.js";
import type { AccountRepositoryPort } from "./account.repository.port.js";

@Injectable()
export class AccountRepository implements AccountRepositoryPort {
  constructor(private readonly transactions: TransactionManager) {}

  private get db() {
    return this.transactions.connection;
  }

  async findById(id: string): Promise<Account | undefined> {
    const row = await this.db.selectFrom("account").selectAll().where("id", "=", id).executeTakeFirst();
    return row && accountFromRow(row);
  }

  async findByEmail(email: string): Promise<Account[]> {
    const rows = await this.db
      .selectFrom("account")
      .selectAll()
      .where(sql<string>`lower(email)`, "=", email.toLowerCase())
      .execute();
    return rows.map(accountFromRow);
  }

  async ensureForPrincipal(principal: Principal): Promise<Account> {
    const profile = {
      username: principal.username ?? null,
      name: principal.name ?? null,
      email: principal.email ?? null,
    };
    const existing = await this.db
      .selectFrom("account")
      .selectAll()
      .where("subject", "=", principal.subject)
      .executeTakeFirst();
    if (
      existing &&
      existing.username === profile.username &&
      existing.name === profile.name &&
      existing.email === profile.email
    ) {
      return accountFromRow(existing);
    }
    // Either the first request or a changed profile. One upsert covers both, and two first
    // requests racing each other end up with the same account.
    const row = await this.db
      .insertInto("account")
      .values({ subject: principal.subject, ...profile })
      .onConflict((conflict) => conflict.column("subject").doUpdateSet(profile))
      .returningAll()
      .executeTakeFirstOrThrow();
    return accountFromRow(row);
  }

  async ensureForSubject(subject: string): Promise<{ account: Account; created: boolean }> {
    const inserted = await this.db
      .insertInto("account")
      .values({ subject })
      .onConflict((conflict) => conflict.column("subject").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) {
      return { account: accountFromRow(inserted), created: true };
    }
    const row = await this.db
      .selectFrom("account")
      .selectAll()
      .where("subject", "=", subject)
      .executeTakeFirstOrThrow();
    return { account: accountFromRow(row), created: false };
  }

  async save(account: Account): Promise<void> {
    await this.db.updateTable("account").set({ role: account.role }).where("id", "=", account.id).execute();
  }

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.transactions.run(work);
  }
}
