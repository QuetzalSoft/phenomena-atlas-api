import { Module } from "@nestjs/common";
import { ChangePhenomenonStatusHttpController } from "./commands/change-phenomenon-status/change-phenomenon-status.http.controller.js";
import { ChangePhenomenonStatusService } from "./commands/change-phenomenon-status/change-phenomenon-status.service.js";
import { CreatePhenomenonHttpController } from "./commands/create-phenomenon/create-phenomenon.http.controller.js";
import { CreatePhenomenonService } from "./commands/create-phenomenon/create-phenomenon.service.js";
import { DeletePhenomenonHttpController } from "./commands/delete-phenomenon/delete-phenomenon.http.controller.js";
import { DeletePhenomenonService } from "./commands/delete-phenomenon/delete-phenomenon.service.js";
import { UpdatePhenomenonHttpController } from "./commands/update-phenomenon/update-phenomenon.http.controller.js";
import { UpdatePhenomenonService } from "./commands/update-phenomenon/update-phenomenon.service.js";
import { PhenomenonIndexCalculator } from "./database/phenomenon-index.calculator.js";
import { PhenomenonReader } from "./database/phenomenon.reader.js";
import { PhenomenonRepository } from "./database/phenomenon.repository.js";
import { PHENOMENON_INDEX_CALCULATOR, PHENOMENON_REPOSITORY } from "./phenomenon.di-tokens.js";
import { GetPhenomenonHttpController } from "./queries/get-phenomenon/get-phenomenon.http.controller.js";
import { GetPhenomenonQueryHandler } from "./queries/get-phenomenon/get-phenomenon.query-handler.js";
import { ListPhenomenaHttpController } from "./queries/list-phenomena/list-phenomena.http.controller.js";
import { ListPhenomenaQueryHandler } from "./queries/list-phenomena/list-phenomena.query-handler.js";

@Module({
  controllers: [
    ListPhenomenaHttpController,
    GetPhenomenonHttpController,
    CreatePhenomenonHttpController,
    UpdatePhenomenonHttpController,
    ChangePhenomenonStatusHttpController,
    DeletePhenomenonHttpController,
  ],
  providers: [
    { provide: PHENOMENON_REPOSITORY, useClass: PhenomenonRepository },
    { provide: PHENOMENON_INDEX_CALCULATOR, useClass: PhenomenonIndexCalculator },
    ListPhenomenaQueryHandler,
    GetPhenomenonQueryHandler,
    CreatePhenomenonService,
    UpdatePhenomenonService,
    ChangePhenomenonStatusService,
    DeletePhenomenonService,
    PhenomenonReader,
  ],
  exports: [PhenomenonReader],
})
export class PhenomenonModule {}
