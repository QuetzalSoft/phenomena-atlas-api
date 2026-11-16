import { Body, Controller, Param, ParseIntPipe, Put } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { definitionFromRequest } from "../../phenomenon.mapper.js";
import { readBack } from "../create-phenomenon/create-phenomenon.http.controller.js";
import { phenomenonHttpError } from "../phenomenon-http-error.js";
import { UpdatePhenomenonCommand } from "./update-phenomenon.command.js";

@Controller()
export class UpdatePhenomenonHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Put("phenomena/:phenomenonId")
  async updatePhenomenon(
    @Param("phenomenonId", ParseIntPipe) id: number,
    @Body() body: Schemas["PhenomenonChange"],
  ): Promise<Schemas["Phenomenon"]> {
    const result = await this.commandBus.execute(new UpdatePhenomenonCommand(id, body.baseRevision, definitionFromRequest(body)));
    if (result.isErr()) {
      throw phenomenonHttpError(result.error);
    }
    return readBack(this.queryBus, id);
  }
}
