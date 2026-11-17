import type { IncidentReportDraft } from "../domain/incident-report.js";

/** A checked report, ready to store. */
export interface NewIncidentReport extends IncidentReportDraft {
  phenomenonId: number;
  authorAccountId: string;
}

export interface IncidentReportRepositoryPort {
  /** Stores a report and returns its id. */
  insert(report: NewIncidentReport): Promise<number>;

  /** Removes a report. Resolves to false when there was none. */
  delete(id: number): Promise<boolean>;

  /** Runs `work` in one transaction. See TransactionManager.run. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
