import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import type { Kysely } from "kysely";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { findReport } from "../incident-report.read.js";
import { GetIncidentReportQuery } from "./get-incident-report.query.js";

@QueryHandler(GetIncidentReportQuery)
export class GetIncidentReportQueryHandler implements IQueryHandler<GetIncidentReportQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  execute({ id }: GetIncidentReportQuery): Promise<Schemas["IncidentReport"] | undefined> {
    return findReport(this.db, id);
  }
}
