import { Module } from "@nestjs/common";
import { PhenomenonModule } from "../phenomenon/phenomenon.public.js";
import { RegionModule } from "../region/region.public.js";
import { FileIncidentReportHttpController } from "./commands/file-incident-report/file-incident-report.http.controller.js";
import { FileIncidentReportService } from "./commands/file-incident-report/file-incident-report.service.js";
import { RemoveIncidentReportHttpController } from "./commands/remove-incident-report/remove-incident-report.http.controller.js";
import { RemoveIncidentReportService } from "./commands/remove-incident-report/remove-incident-report.service.js";
import { IncidentReportRepository } from "./database/incident-report.repository.js";
import { INCIDENT_REPORT_REPOSITORY } from "./incident-report.di-tokens.js";
import { GetIncidentReportQueryHandler } from "./queries/get-incident-report/get-incident-report.query-handler.js";
import { ListMyIncidentReportsHttpController } from "./queries/list-my-incident-reports/list-my-incident-reports.http.controller.js";
import { ListMyIncidentReportsQueryHandler } from "./queries/list-my-incident-reports/list-my-incident-reports.query-handler.js";
import { ListPhenomenonIncidentReportsHttpController } from "./queries/list-phenomenon-incident-reports/list-phenomenon-incident-reports.http.controller.js";
import { ListPhenomenonIncidentReportsQueryHandler } from "./queries/list-phenomenon-incident-reports/list-phenomenon-incident-reports.query-handler.js";

@Module({
  imports: [PhenomenonModule, RegionModule],
  controllers: [
    FileIncidentReportHttpController,
    ListPhenomenonIncidentReportsHttpController,
    ListMyIncidentReportsHttpController,
    RemoveIncidentReportHttpController,
  ],
  providers: [
    { provide: INCIDENT_REPORT_REPOSITORY, useClass: IncidentReportRepository },
    FileIncidentReportService,
    RemoveIncidentReportService,
    GetIncidentReportQueryHandler,
    ListPhenomenonIncidentReportsQueryHandler,
    ListMyIncidentReportsQueryHandler,
  ],
})
export class IncidentReportModule {}
