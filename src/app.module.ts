import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { HealthModule } from "./modules/health/health.module.js";

@Module({
  imports: [CqrsModule.forRoot(), HealthModule],
})
export class AppModule {}
