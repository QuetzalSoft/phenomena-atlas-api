import { Command } from "@nestjs/cqrs";
import type { Result } from "neverthrow";
import type { PhenomenonDefinition } from "../../domain/phenomenon.entity.js";
import type { PhenomenonDefinitionError } from "../../domain/phenomenon.errors.js";

/** Creates a phenomenon as a draft. Resolves to its id. */
export class CreatePhenomenonCommand extends Command<Result<number, PhenomenonDefinitionError>> {
  constructor(readonly definition: PhenomenonDefinition) {
    super();
  }
}
