import { Query } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import type { PartitionNotLoadedError, PartitionVersionNotFoundError } from "../../domain/region.errors.js";

/** The regions of one partition version: the latest when no number is given. */
export class GetRegionPartitionQuery extends Query<
  Result<Schemas["RegionPartition"], PartitionNotLoadedError | PartitionVersionNotFoundError>
> {
  constructor(readonly version?: number) {
    super();
  }
}
