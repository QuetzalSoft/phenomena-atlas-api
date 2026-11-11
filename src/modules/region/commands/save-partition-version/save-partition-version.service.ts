import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, ok, type Result } from "neverthrow";
import type { RegionRepositoryPort } from "../../database/region.repository.port.js";
import { type PlannedChange, planChange } from "../../domain/partition-change.js";
import { type PartitionChangeError, PartitionVersionConflictError } from "../../domain/region.errors.js";
import { REGION_REPOSITORY } from "../../region.di-tokens.js";
import { SavePartitionVersionCommand } from "./save-partition-version.command.js";

/** Carries a broken rule out of the transaction, so throwing it rolls the change back. */
class RejectedChange extends Error {
  constructor(readonly reason: PartitionChangeError) {
    super(reason.message);
  }
}

@CommandHandler(SavePartitionVersionCommand)
export class SavePartitionVersionService implements ICommandHandler<SavePartitionVersionCommand> {
  constructor(@Inject(REGION_REPOSITORY) private readonly regions: RegionRepositoryPort) {}

  async execute({ change, authorAccountId }: SavePartitionVersionCommand): Promise<Result<number, PartitionChangeError>> {
    try {
      return ok(
        await this.regions.transaction(async () => {
          const state = await this.regions.lockPartition();
          if (!state) {
            // Nothing to base a change on before the initial load.
            throw new RejectedChange(new PartitionVersionConflictError());
          }
          const planned = planChange(change, state);
          if (planned.isErr()) {
            throw new RejectedChange(planned.error);
          }
          // The geometry rules need the change applied, so a broken one rolls it back.
          const createdIds = await this.regions.apply(planned.value, authorAccountId);
          const broken = await this.regions.findBrokenRule(planned.value.version);
          if (broken) {
            throw new RejectedChange(pointAtDrafts(broken, planned.value, createdIds));
          }
          return planned.value.version;
        }),
      );
    } catch (error) {
      if (error instanceof RejectedChange) {
        return err(error.reason);
      }
      throw error;
    }
  }
}

/**
 * New regions got ids inside the rolled-back transaction, which mean nothing to the client.
 * Point at those by their position in the change instead.
 */
function pointAtDrafts(error: PartitionChangeError, change: PlannedChange, createdIds: number[]): PartitionChangeError {
  const indexById = new Map(createdIds.map((id, position) => [id, change.created[position]?.index]));
  const regionIds = error.details.regionIds ?? [];
  const draftIndexes = regionIds.flatMap((id) => {
    const index = indexById.get(id);
    return index === undefined ? [] : [index];
  });
  if (draftIndexes.length === 0) {
    return error;
  }
  const existing = regionIds.filter((id) => !indexById.has(id));
  const { geometry } = error.details;
  error.details = {
    ...(existing.length > 0 && { regionIds: existing }),
    draftIndexes,
    ...(geometry && { geometry }),
  };
  return error;
}
