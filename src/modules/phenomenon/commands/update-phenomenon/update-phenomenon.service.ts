import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, ok, type Result } from "neverthrow";
import type { PhenomenonRepositoryPort } from "../../database/phenomenon.repository.port.js";
import {
  type PhenomenonDefinitionError,
  PhenomenonNotFoundError,
  type PhenomenonRevisionConflictError,
} from "../../domain/phenomenon.errors.js";
import { PHENOMENON_REPOSITORY } from "../../phenomenon.di-tokens.js";
import { UpdatePhenomenonCommand } from "./update-phenomenon.command.js";

@CommandHandler(UpdatePhenomenonCommand)
export class UpdatePhenomenonService implements ICommandHandler<UpdatePhenomenonCommand> {
  constructor(@Inject(PHENOMENON_REPOSITORY) private readonly phenomena: PhenomenonRepositoryPort) {}

  execute({
    id,
    baseRevision,
    definition,
    refreshIntervalMinutes,
  }: UpdatePhenomenonCommand): Promise<Result<void, PhenomenonDefinitionError | PhenomenonNotFoundError | PhenomenonRevisionConflictError>> {
    // Nothing is written before the checks pass, so a refusal needs no rollback.
    return this.phenomena.transaction(async () => {
      const phenomenon = await this.phenomena.findForUpdate(id);
      if (!phenomenon) {
        return err(new PhenomenonNotFoundError());
      }
      const redefined = phenomenon.redefine(definition, baseRevision, refreshIntervalMinutes);
      if (redefined.isErr()) {
        return err(redefined.error);
      }
      await this.phenomena.save(phenomenon);
      return ok(undefined);
    });
  }
}
