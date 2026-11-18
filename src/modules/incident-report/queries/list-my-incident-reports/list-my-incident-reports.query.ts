import { Query } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import type { InvalidCursorError } from "../report-cursor.js";

/** A page of the reports one account filed. */
export class ListMyIncidentReportsQuery extends Query<Result<Schemas["IncidentReportPage"], InvalidCursorError>> {
  constructor(
    readonly authorAccountId: string,
    readonly limit: number,
    readonly cursor?: string,
    readonly phenomenonId?: number,
  ) {
    super();
  }
}
