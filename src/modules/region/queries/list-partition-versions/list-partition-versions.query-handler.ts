import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { type Kysely, sql } from "kysely";
import { err, ok, type Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { GetPartitionVersionSummaryQuery, ListPartitionVersionsQuery } from "./list-partition-versions.query.js";
import { decodeVersionCursor, encodeVersionCursor, type InvalidVersionCursorError } from "./version-cursor.js";

@QueryHandler(ListPartitionVersionsQuery)
export class ListPartitionVersionsQueryHandler implements IQueryHandler<ListPartitionVersionsQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute({
    limit,
    cursor,
  }: ListPartitionVersionsQuery): Promise<Result<Schemas["PartitionVersionPage"], InvalidVersionCursorError>> {
    let before: number | undefined;
    if (cursor !== undefined) {
      const decoded = decodeVersionCursor(cursor);
      if (decoded.isErr()) {
        return err(decoded.error);
      }
      before = decoded.value;
    }
    // One extra row tells whether another page follows.
    const versions = await readVersionSummaries(this.db, { before, limit: limit + 1 });
    const page = versions.slice(0, limit);
    const last = page.at(-1);
    return ok({
      items: page,
      ...(versions.length > limit && last && { nextCursor: encodeVersionCursor(last.number) }),
    });
  }
}

@QueryHandler(GetPartitionVersionSummaryQuery)
export class GetPartitionVersionSummaryQueryHandler implements IQueryHandler<GetPartitionVersionSummaryQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute({ number }: GetPartitionVersionSummaryQuery): Promise<Schemas["PartitionVersion"] | undefined> {
    const [version] = await readVersionSummaries(this.db, { only: number, limit: 1 });
    return version;
  }
}

interface VersionFilter {
  /** Only versions older than this one. */
  before?: number | undefined;
  /** Only this version. */
  only?: number;
  limit: number;
}

/**
 * Versions newest first, with what each one changed. A region counts as changed in a version
 * when it got a new state there without being created there.
 */
async function readVersionSummaries(db: Kysely<Database>, filter: VersionFilter): Promise<Schemas["PartitionVersion"][]> {
  let query = db
    .selectFrom("partition_version as v")
    .leftJoin("account as a", "a.id", "v.author_account_id")
    .select([
      "v.number",
      "v.created_at",
      "a.id as author_id",
      "a.username as author_username",
      "a.name as author_name",
      sql<number[]>`ARRAY(SELECT id FROM region WHERE created_in = v.number ORDER BY id)`.as("added"),
      sql<number[]>`ARRAY(
        SELECT s.region_id FROM region_state s JOIN region r ON r.id = s.region_id
        WHERE s.valid_from = v.number AND r.created_in < v.number ORDER BY s.region_id
      )`.as("changed"),
      sql<number[]>`ARRAY(SELECT id FROM region WHERE retired_in = v.number ORDER BY id)`.as("retired"),
    ])
    .orderBy("v.number", "desc")
    .limit(filter.limit);
  if (filter.before !== undefined) {
    query = query.where("v.number", "<", filter.before);
  }
  if (filter.only !== undefined) {
    query = query.where("v.number", "=", filter.only);
  }
  const rows = await query.execute();
  return rows.map((row) => ({
    number: row.number,
    createdAt: row.created_at.toISOString(),
    ...(row.author_id !== null && {
      author: {
        id: row.author_id,
        ...(row.author_username !== null && { username: row.author_username }),
        ...(row.author_name !== null && { name: row.author_name }),
      },
    }),
    added: row.added,
    changed: row.changed,
    retired: row.retired,
  }));
}
