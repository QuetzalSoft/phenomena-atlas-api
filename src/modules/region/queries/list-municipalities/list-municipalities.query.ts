import { Query } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";

export class ListMunicipalitiesQuery extends Query<Schemas["MunicipalityCollection"]> {}
