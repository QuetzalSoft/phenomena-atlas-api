import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { PartitionChange } from "../../domain/partition-change.js";
import type { PartitionChangeError } from "../../domain/region.errors.js";

/** Saves a change to the region partition as its next version. Resolves to that version's number. */
export class SavePartitionVersionCommand extends Command<Result<number, PartitionChangeError>> {
  constructor(
    readonly change: PartitionChange,
    readonly authorAccountId: string,
  ) {
    super();
  }
}
