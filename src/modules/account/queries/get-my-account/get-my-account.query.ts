import { Query } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";

export class GetMyAccountQuery extends Query<Schemas["Account"]> {
  constructor(readonly accountId: string) {
    super();
  }
}
