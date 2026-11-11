import { Controller, Get } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { ListMunicipalitiesQuery } from "./list-municipalities.query.js";

@Controller()
export class ListMunicipalitiesHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("municipalities")
  listMunicipalities(): Promise<Schemas["MunicipalityCollection"]> {
    return this.queryBus.execute(new ListMunicipalitiesQuery());
  }
}
