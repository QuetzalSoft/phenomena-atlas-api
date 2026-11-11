import { Query } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";

export class GetHealthQuery extends Query<Schemas["Health"]> {}
