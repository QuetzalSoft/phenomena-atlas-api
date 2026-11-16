import { Controller, Delete, HttpCode, Param, ParseIntPipe } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { phenomenonHttpError } from "../phenomenon-http-error.js";
import { DeletePhenomenonCommand } from "./delete-phenomenon.command.js";

@Controller()
export class DeletePhenomenonHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Delete("phenomena/:phenomenonId")
  @HttpCode(204)
  async deletePhenomenon(@Param("phenomenonId", ParseIntPipe) id: number): Promise<void> {
    const result = await this.commandBus.execute(new DeletePhenomenonCommand(id));
    if (result.isErr()) {
      throw phenomenonHttpError(result.error);
    }
  }
}
