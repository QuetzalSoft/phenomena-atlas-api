import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { type Kysely, sql } from "kysely";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { asGeoJson } from "../../database/geometry.sql.js";
import { ListMunicipalitiesQuery } from "./list-municipalities.query.js";

@QueryHandler(ListMunicipalitiesQuery)
export class ListMunicipalitiesQueryHandler implements IQueryHandler<ListMunicipalitiesQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute(): Promise<Schemas["MunicipalityCollection"]> {
    const rows = await this.db
      .selectFrom("municipality")
      .select(["code", "name", asGeoJson(sql.ref("geometry")).as("geometry")])
      .orderBy("code")
      .execute();
    return {
      type: "FeatureCollection",
      features: rows.map((row) => ({
        type: "Feature",
        id: row.code,
        geometry: row.geometry,
        properties: { name: row.name },
      })),
    };
  }
}
