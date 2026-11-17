import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import type { Kysely } from "kysely";
import type { Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { listReports } from "../incident-report.read.js";
import type { InvalidCursorError } from "../report-cursor.js";
import { ListMyIncidentReportsQuery } from "./list-my-incident-reports.query.js";

@QueryHandler(ListMyIncidentReportsQuery)
export class ListMyIncidentReportsQueryHandler implements IQueryHandler<ListMyIncidentReportsQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  execute({ authorAccountId, limit, cursor, phenomenonId }: ListMyIncidentReportsQuery): Promise<Result<Schemas["IncidentReportPage"], InvalidCursorError>> {
    return listReports(this.db, { authorAccountId, ...(phenomenonId !== undefined && { phenomenonId }) }, limit, cursor);
  }
}
