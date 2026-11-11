import { type DynamicModule, Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import type { AppConfig } from "./configs/app.config.js";
import { DatabaseModule } from "./libs/db/database.module.js";
import { HealthModule } from "./modules/health/health.module.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CqrsModule.forRoot(), DatabaseModule.forRoot({ url: config.databaseUrl }), HealthModule],
    };
  }
}
