import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { PhenomenonDefinition } from "../../domain/phenomenon.entity.js";
import type {
  PhenomenonDefinitionError,
  PhenomenonNotFoundError,
  PhenomenonRevisionConflictError,
} from "../../domain/phenomenon.errors.js";

/** Replaces a phenomenon's definition as a whole. */
export class UpdatePhenomenonCommand extends Command<
  Result<void, PhenomenonDefinitionError | PhenomenonNotFoundError | PhenomenonRevisionConflictError>
> {
  constructor(
    readonly id: number,
    readonly baseRevision: number,
    readonly definition: PhenomenonDefinition,
  ) {
    super();
  }
}
