import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { GetHealthQuery } from "./get-health.query.js";

@QueryHandler(GetHealthQuery)
export class GetHealthQueryHandler implements IQueryHandler<GetHealthQuery> {
  execute(): Promise<Schemas["Health"]> {
    return Promise.resolve({ status: "ok" });
  }
}
