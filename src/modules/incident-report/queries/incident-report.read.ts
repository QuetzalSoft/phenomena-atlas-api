import { type Kysely, sql } from "kysely";
import { err, ok, type Result } from "neverthrow";
import type { Schemas } from "../../../libs/api/contract.js";
import type { Database } from "../../../libs/db/database.js";
import { decodeCursor, encodeCursor, type InvalidCursorError } from "./report-cursor.js";

// The read side shared by every query of the module. A report never carries its author
// (ADR 0013), so no query selects author_account_id; filtering by it is how "my reports" works.

/** Optional, and combined with AND. */
export interface ReportFilters {
  id?: number;
  phenomenonId?: number;
  authorAccountId?: string;
  regionId?: number;
  /** YYYY-MM-DD, inclusive. */
  occurredFrom?: string;
  /** YYYY-MM-DD, exclusive. */
  occurredBefore?: string;
}

function selectReports(db: Kysely<Database>, filters: ReportFilters) {
  let query = db
    .selectFrom("incident_report as r")
    .innerJoin("phenomenon as p", "p.id", "r.phenomenon_id")
    .select(["r.id", "r.phenomenon_id", "p.name as phenomenon_name", "r.region_id", "r.description", "r.characteristic_values", "r.created_at"])
    .select(sql<string>`r.occurred_on::text`.as("occurred_on"))
    // The region's latest name: its current state, or its last one if a version retired it.
    .select(
      sql<string>`(SELECT s.name FROM region_state s WHERE s.region_id = r.region_id ORDER BY s.valid_from DESC LIMIT 1)`.as(
        "region_name",
      ),
    )
    .select(sql<string>`to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("cursor_created_at"));
  const { id, phenomenonId, authorAccountId, regionId, occurredFrom, occurredBefore } = filters;
  if (id !== undefined) {
    query = query.where("r.id", "=", id);
  }
  if (phenomenonId !== undefined) {
    query = query.where("r.phenomenon_id", "=", phenomenonId);
  }
  if (authorAccountId !== undefined) {
    query = query.where("r.author_account_id", "=", authorAccountId);
  }
  if (regionId !== undefined) {
    query = query.where("r.region_id", "=", regionId);
  }
  if (occurredFrom !== undefined) {
    query = query.where(sql<boolean>`r.occurred_on >= ${occurredFrom}::date`);
  }
  if (occurredBefore !== undefined) {
    query = query.where(sql<boolean>`r.occurred_on < ${occurredBefore}::date`);
  }
  return query;
}

type ReportRow = Awaited<ReturnType<ReturnType<typeof selectReports>["executeTakeFirstOrThrow"]>>;

function reportResponse(row: ReportRow): Schemas["IncidentReport"] {
  return {
    id: row.id,
    phenomenonId: row.phenomenon_id,
    phenomenonName: row.phenomenon_name,
    regionId: row.region_id,
    regionName: row.region_name,
    occurredOn: row.occurred_on,
    ...(row.description !== null && { description: row.description }),
    // Only ever written from checked values.
    values: row.characteristic_values as Schemas["IncidentReport"]["values"],
    createdAt: row.created_at.toISOString(),
  };
}

/** One report, or undefined. */
export async function findReport(db: Kysely<Database>, id: number): Promise<Schemas["IncidentReport"] | undefined> {
  const row = await selectReports(db, { id }).executeTakeFirst();
  return row && reportResponse(row);
}

/** One page of the reports that match, most recently filed first. */
export async function listReports(
  db: Kysely<Database>,
  filters: ReportFilters,
  limit: number,
  cursor: string | undefined,
): Promise<Result<Schemas["IncidentReportPage"], InvalidCursorError>> {
  let query = selectReports(db, filters)
    .orderBy("r.created_at", "desc")
    .orderBy("r.id", "desc")
    // One extra row tells whether another page follows.
    .limit(limit + 1);
  if (cursor !== undefined) {
    const after = decodeCursor(cursor);
    if (after.isErr()) {
      return err(after.error);
    }
    query = query.where(sql<boolean>`(r.created_at, r.id) < (${after.value.createdAt}::timestamptz, ${after.value.id}::integer)`);
  }
  const rows = await query.execute();

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return ok({
    items: page.map(reportResponse),
    ...(rows.length > limit && last && { nextCursor: encodeCursor({ createdAt: last.cursor_created_at, id: last.id }) }),
  });
}
