import { Module } from "@nestjs/common";
import { GetHealthHttpController } from "./queries/get-health/get-health.http.controller.js";
import { GetHealthQueryHandler } from "./queries/get-health/get-health.query-handler.js";

@Module({
  controllers: [GetHealthHttpController],
  providers: [GetHealthQueryHandler],
})
export class HealthModule {}
