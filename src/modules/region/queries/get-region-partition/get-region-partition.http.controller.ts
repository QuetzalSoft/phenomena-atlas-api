import { Controller, Get, Param } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { GetRegionPartitionQuery } from "./get-region-partition.query.js";

@Controller()
export class GetRegionPartitionHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("region-partition")
  getRegionPartition(): Promise<Schemas["RegionPartition"]> {
    return this.read(new GetRegionPartitionQuery());
  }

  @Get("region-partition/versions/:number")
  getPartitionVersion(@Param("number") number: string): Promise<Schemas["RegionPartition"]> {
    // The validator has checked it is a positive integer, but path values arrive as strings.
    return this.read(new GetRegionPartitionQuery(Number(number)));
  }

  private async read(query: GetRegionPartitionQuery): Promise<Schemas["RegionPartition"]> {
    const result = await this.queryBus.execute(query);
    return result.match(
      (partition) => partition,
      (error) => {
        throw new ContractHttpException(404, error.code, error.message);
      },
    );
  }
}
