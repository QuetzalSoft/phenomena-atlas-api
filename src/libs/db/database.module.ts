import { type DynamicModule, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import type { Kysely } from "kysely";
import { createDatabase, DATABASE, type Database } from "./database.js";
import { TransactionManager } from "./transaction-manager.js";

export interface DatabaseOptions {
  url: string;
}

/** Provides the Kysely instance and the transaction manager to every module. */
@Module({})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [{ provide: DATABASE, useFactory: () => createDatabase(options.url) }, TransactionManager],
      exports: [DATABASE, TransactionManager],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
