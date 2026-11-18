import { Query } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import type { PhenomenonNotFoundError } from "../../../phenomenon/phenomenon.public.js";
import type { InvalidCursorError } from "../report-cursor.js";

/** Optional, and combined with AND. */
export interface PhenomenonReportFilters {
  regionId?: number;
  /** YYYY-MM-DD, inclusive. */
  occurredFrom?: string;
  /** YYYY-MM-DD, exclusive. */
  occurredBefore?: string;
}

export class InvalidDateRangeError extends Error {
  readonly code = "invalid_date_range";

  constructor() {
    super("occurredFrom must be earlier than occurredBefore.");
  }
}

export type ListPhenomenonIncidentReportsError = PhenomenonNotFoundError | InvalidCursorError | InvalidDateRangeError;

/** A page of a phenomenon's reports, without their authors. */
export class ListPhenomenonIncidentReportsQuery extends Query<Result<Schemas["IncidentReportPage"], ListPhenomenonIncidentReportsError>> {
  constructor(
    readonly phenomenonId: number,
    readonly limit: number,
    readonly cursor?: string,
    readonly filters: PhenomenonReportFilters = {},
  ) {
    super();
  }
}
