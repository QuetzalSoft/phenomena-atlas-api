import { Query } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import type { InvalidVersionCursorError } from "./version-cursor.js";

/** A page of partition versions, newest first. */
export class ListPartitionVersionsQuery extends Query<Result<Schemas["PartitionVersionPage"], InvalidVersionCursorError>> {
  constructor(
    readonly limit: number,
    readonly cursor?: string,
  ) {
    super();
  }
}

/** One partition version and what it changed. Resolves to undefined when there is no such version. */
export class GetPartitionVersionSummaryQuery extends Query<Schemas["PartitionVersion"] | undefined> {
  constructor(readonly number: number) {
    super();
  }
}
