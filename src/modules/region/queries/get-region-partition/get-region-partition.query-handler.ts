import { Inject } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { type Kysely, sql } from "kysely";
import { err, ok, type Result } from "neverthrow";
import type { Schemas } from "../../../../libs/api/contract.js";
import { DATABASE, type Database } from "../../../../libs/db/database.js";
import { asGeoJson } from "../../database/geometry.sql.js";
import { PartitionNotLoadedError, PartitionVersionNotFoundError } from "../../domain/region.errors.js";
import { GetRegionPartitionQuery } from "./get-region-partition.query.js";

@QueryHandler(GetRegionPartitionQuery)
export class GetRegionPartitionQueryHandler implements IQueryHandler<GetRegionPartitionQuery> {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async execute({
    version: requested,
  }: GetRegionPartitionQuery): Promise<Result<Schemas["RegionPartition"], PartitionNotLoadedError | PartitionVersionNotFoundError>> {
    let versionQuery = this.db.selectFrom("partition_version").select(["number", "created_at"]);
    versionQuery =
      requested === undefined
        ? versionQuery.orderBy("number", "desc").limit(1)
        : versionQuery.where("number", "=", requested);
    const version = await versionQuery.executeTakeFirst();
    if (!version) {
      return err(requested === undefined ? new PartitionNotLoadedError() : new PartitionVersionNotFoundError());
    }

    // The state each region had in that version: valid from it or earlier, and not yet replaced.
    const rows = await this.db
      .selectFrom("region_state as s")
      .innerJoin("region as r", "r.id", "s.region_id")
      .select(["r.id", "r.municipality_code", "s.name", "s.population", asGeoJson(sql.ref("s.geometry")).as("geometry")])
      .where("s.valid_from", "<=", version.number)
      .where((eb) => eb.or([eb("s.valid_to", "is", null), eb("s.valid_to", ">", version.number)]))
      .orderBy("r.id")
      .execute();

    return ok({
      type: "FeatureCollection",
      version: version.number,
      createdAt: version.created_at.toISOString(),
      features: rows.map((row) => ({
        type: "Feature",
        id: row.id,
        geometry: row.geometry,
        properties: { name: row.name, population: row.population, municipalityCode: row.municipality_code },
      })),
    });
  }
}
