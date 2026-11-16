import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { PhenomenonNotDraftError, PhenomenonNotFoundError } from "../../domain/phenomenon.errors.js";

/** Deletes a draft phenomenon. */
export class DeletePhenomenonCommand extends Command<Result<void, PhenomenonNotFoundError | PhenomenonNotDraftError>> {
  constructor(readonly id: number) {
    super();
  }
}
