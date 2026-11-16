import { Query } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import type { PhenomenonStatus } from "../../domain/phenomenon.entity.js";

/** Phenomena by name, only those with `status` when it is given. */
export class ListPhenomenaQuery extends Query<Schemas["PhenomenonList"]> {
  constructor(readonly status?: PhenomenonStatus) {
    super();
  }
}
