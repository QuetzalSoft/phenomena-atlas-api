import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { PhenomenonStatus } from "../../domain/phenomenon.entity.js";
import type {
  IncompleteWeightingFunctionError,
  InvalidStatusTransitionError,
  PhenomenonNotFoundError,
  PhenomenonRevisionConflictError,
} from "../../domain/phenomenon.errors.js";

export type ChangePhenomenonStatusError =
  | PhenomenonNotFoundError
  | PhenomenonRevisionConflictError
  | InvalidStatusTransitionError
  | IncompleteWeightingFunctionError;

/** Publishes, archives or republishes a phenomenon. */
export class ChangePhenomenonStatusCommand extends Command<Result<void, ChangePhenomenonStatusError>> {
  constructor(
    readonly id: number,
    readonly baseRevision: number,
    readonly status: PhenomenonStatus,
  ) {
    super();
  }
}
