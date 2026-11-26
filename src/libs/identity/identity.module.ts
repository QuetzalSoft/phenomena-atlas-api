import { type DynamicModule, Module } from "@nestjs/common";
import { KEYCLOAK_ADMIN_OPTIONS, type KeycloakAdminOptions } from "./keycloak-admin-options.js";

/** Provides how to reach Keycloak as the service account, to every module that needs it. */
@Module({})
export class IdentityModule {
  static forRoot(options: KeycloakAdminOptions): DynamicModule {
    return {
      module: IdentityModule,
      global: true,
      providers: [{ provide: KEYCLOAK_ADMIN_OPTIONS, useValue: options }],
      exports: [KEYCLOAK_ADMIN_OPTIONS],
    };
  }
}
