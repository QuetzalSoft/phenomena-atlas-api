import { Controller, Get } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { GetHealthQuery } from "./get-health.query.js";

@Controller()
export class GetHealthHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("health")
  async getHealth(): Promise<Schemas["Health"]> {
    const health = await this.queryBus.execute(new GetHealthQuery());
    return { status: health.status };
  }
}
