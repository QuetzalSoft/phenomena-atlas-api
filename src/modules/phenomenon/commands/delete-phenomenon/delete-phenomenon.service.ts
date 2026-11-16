import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, ok, type Result } from "neverthrow";
import type { PhenomenonRepositoryPort } from "../../database/phenomenon.repository.port.js";
import { type PhenomenonNotDraftError, PhenomenonNotFoundError } from "../../domain/phenomenon.errors.js";
import { PHENOMENON_REPOSITORY } from "../../phenomenon.di-tokens.js";
import { DeletePhenomenonCommand } from "./delete-phenomenon.command.js";

@CommandHandler(DeletePhenomenonCommand)
export class DeletePhenomenonService implements ICommandHandler<DeletePhenomenonCommand> {
  constructor(@Inject(PHENOMENON_REPOSITORY) private readonly phenomena: PhenomenonRepositoryPort) {}

  execute({ id }: DeletePhenomenonCommand): Promise<Result<void, PhenomenonNotFoundError | PhenomenonNotDraftError>> {
    return this.phenomena.transaction(async () => {
      const phenomenon = await this.phenomena.findForUpdate(id);
      if (!phenomenon) {
        return err(new PhenomenonNotFoundError());
      }
      const deletable = phenomenon.checkDeletable();
      if (deletable.isErr()) {
        return err(deletable.error);
      }
      await this.phenomena.delete(id);
      return ok(undefined);
    });
  }
}
