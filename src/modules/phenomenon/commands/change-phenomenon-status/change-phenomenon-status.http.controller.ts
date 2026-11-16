import { Body, Controller, Param, ParseIntPipe, Put } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { readBack } from "../create-phenomenon/create-phenomenon.http.controller.js";
import { phenomenonHttpError } from "../phenomenon-http-error.js";
import { ChangePhenomenonStatusCommand } from "./change-phenomenon-status.command.js";

@Controller()
export class ChangePhenomenonStatusHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Put("phenomena/:phenomenonId/status")
  async changePhenomenonStatus(
    @Param("phenomenonId", ParseIntPipe) id: number,
    @Body() body: Schemas["PhenomenonStatusChange"],
  ): Promise<Schemas["Phenomenon"]> {
    const result = await this.commandBus.execute(new ChangePhenomenonStatusCommand(id, body.baseRevision, body.status));
    if (result.isErr()) {
      throw phenomenonHttpError(result.error);
    }
    return readBack(this.queryBus, id);
  }
}
