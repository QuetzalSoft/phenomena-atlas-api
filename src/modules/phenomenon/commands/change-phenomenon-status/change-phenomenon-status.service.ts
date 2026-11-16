import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, ok, type Result } from "neverthrow";
import type { PhenomenonRepositoryPort } from "../../database/phenomenon.repository.port.js";
import { PhenomenonNotFoundError } from "../../domain/phenomenon.errors.js";
import { PHENOMENON_REPOSITORY } from "../../phenomenon.di-tokens.js";
import { ChangePhenomenonStatusCommand, type ChangePhenomenonStatusError } from "./change-phenomenon-status.command.js";

@CommandHandler(ChangePhenomenonStatusCommand)
export class ChangePhenomenonStatusService implements ICommandHandler<ChangePhenomenonStatusCommand> {
  constructor(@Inject(PHENOMENON_REPOSITORY) private readonly phenomena: PhenomenonRepositoryPort) {}

  execute({ id, baseRevision, status }: ChangePhenomenonStatusCommand): Promise<Result<void, ChangePhenomenonStatusError>> {
    return this.phenomena.transaction(async () => {
      const phenomenon = await this.phenomena.findForUpdate(id);
      if (!phenomenon) {
        return err(new PhenomenonNotFoundError());
      }
      const changed = phenomenon.changeStatus(status, baseRevision);
      if (changed.isErr()) {
        return err(changed.error);
      }
      await this.phenomena.save(phenomenon);
      return ok(undefined);
    });
  }
}
