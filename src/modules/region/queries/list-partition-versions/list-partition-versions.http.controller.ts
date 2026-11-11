import { Controller, Get, Query } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { operations, Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { ListPartitionVersionsQuery } from "./list-partition-versions.query.js";

type ListPartitionVersionsParams = NonNullable<operations["Regions_listPartitionVersions"]["parameters"]["query"]>;

const defaultLimit = 50;

@Controller()
export class ListPartitionVersionsHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("region-partition/versions")
  async listPartitionVersions(@Query() params: ListPartitionVersionsParams): Promise<Schemas["PartitionVersionPage"]> {
    // The validator has checked the range, but query values may still arrive as strings.
    const limit = params.limit === undefined ? defaultLimit : Number(params.limit);
    const result = await this.queryBus.execute(new ListPartitionVersionsQuery(limit, params.cursor));
    return result.match(
      (page) => page,
      (error) => {
        throw new ContractHttpException(400, error.code, error.message);
      },
    );
  }
}
