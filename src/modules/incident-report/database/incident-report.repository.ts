import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../libs/db/transaction-manager.js";
import type { IncidentReportRepositoryPort, NewIncidentReport } from "./incident-report.repository.port.js";

@Injectable()
export class IncidentReportRepository implements IncidentReportRepositoryPort {
  constructor(private readonly transactions: TransactionManager) {}

  private get db() {
    return this.transactions.connection;
  }

  async insert(report: NewIncidentReport): Promise<number> {
    const row = await this.db
      .insertInto("incident_report")
      .values({
        phenomenon_id: report.phenomenonId,
        region_id: report.regionId,
        author_account_id: report.authorAccountId,
        occurred_on: report.occurredOn,
        description: report.description ?? null,
        characteristic_values: JSON.stringify(report.values),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.deleteFrom("incident_report").where("id", "=", id).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.transactions.run(work);
  }
}
