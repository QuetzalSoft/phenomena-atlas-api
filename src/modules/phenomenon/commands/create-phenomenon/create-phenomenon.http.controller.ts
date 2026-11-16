import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { definitionFromRequest } from "../../phenomenon.mapper.js";
import { GetPhenomenonQuery } from "../../queries/get-phenomenon/get-phenomenon.query.js";
import { phenomenonHttpError } from "../phenomenon-http-error.js";
import { CreatePhenomenonCommand } from "./create-phenomenon.command.js";

@Controller()
export class CreatePhenomenonHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post("phenomena")
  @HttpCode(201)
  async createPhenomenon(@Body() body: Schemas["PhenomenonDefinition"]): Promise<Schemas["Phenomenon"]> {
    const result = await this.commandBus.execute(new CreatePhenomenonCommand(definitionFromRequest(body)));
    if (result.isErr()) {
      throw phenomenonHttpError(result.error);
    }
    return readBack(this.queryBus, result.value);
  }
}

/** The phenomenon a command just wrote, as the contract returns it. */
export async function readBack(queryBus: QueryBus, id: number): Promise<Schemas["Phenomenon"]> {
  const phenomenon = await queryBus.execute(new GetPhenomenonQuery(id, { includeUnpublished: true }));
  if (!phenomenon) {
    throw new Error(`Phenomenon ${id} was written but cannot be read back.`);
  }
  return phenomenon;
}
