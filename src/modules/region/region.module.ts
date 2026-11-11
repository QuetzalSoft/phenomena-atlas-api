import { Module } from "@nestjs/common";
import { SavePartitionVersionHttpController } from "./commands/save-partition-version/save-partition-version.http.controller.js";
import { SavePartitionVersionService } from "./commands/save-partition-version/save-partition-version.service.js";
import { RegionRepository } from "./database/region.repository.js";
import { GetRegionPartitionHttpController } from "./queries/get-region-partition/get-region-partition.http.controller.js";
import { GetRegionPartitionQueryHandler } from "./queries/get-region-partition/get-region-partition.query-handler.js";
import { ListMunicipalitiesHttpController } from "./queries/list-municipalities/list-municipalities.http.controller.js";
import { ListMunicipalitiesQueryHandler } from "./queries/list-municipalities/list-municipalities.query-handler.js";
import { ListPartitionVersionsHttpController } from "./queries/list-partition-versions/list-partition-versions.http.controller.js";
import {
  GetPartitionVersionSummaryQueryHandler,
  ListPartitionVersionsQueryHandler,
} from "./queries/list-partition-versions/list-partition-versions.query-handler.js";
import { REGION_REPOSITORY } from "./region.di-tokens.js";

@Module({
  controllers: [
    ListMunicipalitiesHttpController,
    GetRegionPartitionHttpController,
    ListPartitionVersionsHttpController,
    SavePartitionVersionHttpController,
  ],
  providers: [
    { provide: REGION_REPOSITORY, useClass: RegionRepository },
    ListMunicipalitiesQueryHandler,
    GetRegionPartitionQueryHandler,
    ListPartitionVersionsQueryHandler,
    GetPartitionVersionSummaryQueryHandler,
    SavePartitionVersionService,
  ],
})
export class RegionModule {}
