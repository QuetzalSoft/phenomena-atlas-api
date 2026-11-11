import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";
import { ContractHttpException } from "../../../../libs/api/contract-http.exception.js";
import { type AuthorizedRequest, callerOf } from "../../../account/account.public.js";
import { PartitionVersionConflictError } from "../../domain/region.errors.js";
import { GetPartitionVersionSummaryQuery } from "../../queries/list-partition-versions/list-partition-versions.query.js";
import { SavePartitionVersionCommand } from "./save-partition-version.command.js";

@Controller()
export class SavePartitionVersionHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post("region-partition/versions")
  @HttpCode(201)
  async savePartitionVersion(
    @Body() body: Schemas["PartitionChange"],
    @Req() request: AuthorizedRequest,
  ): Promise<Schemas["PartitionVersion"]> {
    const result = await this.commandBus.execute(
      new SavePartitionVersionCommand(
        {
          baseVersion: body.baseVersion,
          regions: body.regions.map((draft) => ({
            ...(draft.id !== undefined && { id: draft.id }),
            municipalityCode: draft.municipalityCode,
            name: draft.name,
            population: draft.population,
            geometry: draft.geometry,
          })),
          retiredRegionIds: body.retiredRegionIds,
        },
        callerOf(request).id,
      ),
    );
    if (result.isErr()) {
      const error = result.error;
      const status = error instanceof PartitionVersionConflictError ? 409 : 400;
      throw new ContractHttpException(status, error.code, error.message, { ...error.details });
    }
    const version = await this.queryBus.execute(new GetPartitionVersionSummaryQuery(result.value));
    if (!version) {
      throw new Error(`Partition version ${result.value} was saved but cannot be read back.`);
    }
    return version;
  }
}
