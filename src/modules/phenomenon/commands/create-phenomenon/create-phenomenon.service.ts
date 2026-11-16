import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { err, ok, type Result } from "neverthrow";
import type { PhenomenonRepositoryPort } from "../../database/phenomenon.repository.port.js";
import { Phenomenon } from "../../domain/phenomenon.entity.js";
import type { PhenomenonDefinitionError } from "../../domain/phenomenon.errors.js";
import { PHENOMENON_REPOSITORY } from "../../phenomenon.di-tokens.js";
import { CreatePhenomenonCommand } from "./create-phenomenon.command.js";

@CommandHandler(CreatePhenomenonCommand)
export class CreatePhenomenonService implements ICommandHandler<CreatePhenomenonCommand> {
  constructor(@Inject(PHENOMENON_REPOSITORY) private readonly phenomena: PhenomenonRepositoryPort) {}

  async execute({ definition }: CreatePhenomenonCommand): Promise<Result<number, PhenomenonDefinitionError>> {
    const checked = Phenomenon.checkNew(definition);
    if (checked.isErr()) {
      return err(checked.error);
    }
    return ok(await this.phenomena.insert(checked.value));
  }
}
