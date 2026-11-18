import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import type { Kysely } from "kysely";
import { err, type Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { PhenomenonNotFoundError } from "../../../phenomenon/phenomenon.public.js";
import { listReports } from "../incident-report.read.js";
import {
  InvalidDateRangeError,
  ListPhenomenonIncidentReportsQuery,
  type ListPhenomenonIncidentReportsError,
} from "./list-phenomenon-incident-reports.query.js";

@QueryHandler(ListPhenomenonIncidentReportsQuery)
export class ListPhenomenonIncidentReportsQueryHandler implements IQueryHandler<ListPhenomenonIncidentReportsQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute({
    phenomenonId,
    limit,
    cursor,
    filters,
  }: ListPhenomenonIncidentReportsQuery): Promise<Result<Schemas["IncidentReportPage"], ListPhenomenonIncidentReportsError>> {
    const { occurredFrom, occurredBefore } = filters;
    // Both are YYYY-MM-DD, so comparing the text compares the dates.
    if (occurredFrom !== undefined && occurredBefore !== undefined && occurredFrom >= occurredBefore) {
      return err(new InvalidDateRangeError());
    }
    const phenomenon = await this.db.selectFrom("phenomenon").select("id").where("id", "=", phenomenonId).executeTakeFirst();
    if (!phenomenon) {
      return err(new PhenomenonNotFoundError());
    }
    return listReports(this.db, { phenomenonId, ...filters }, limit, cursor);
  }
}
