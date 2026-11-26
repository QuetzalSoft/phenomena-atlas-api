import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ACCOUNT_REPOSITORY, IDENTITY_PROVIDER } from "./account.di-tokens.js";
import { AuthorizationGuard } from "./authorization/authorization.guard.js";
import { ChangeAccountRoleHttpController } from "./commands/change-account-role/change-account-role.http.controller.js";
import { ChangeAccountRoleService } from "./commands/change-account-role/change-account-role.service.js";
import { UpdateAccountProfileHttpController } from "./commands/update-account-profile/update-account-profile.http.controller.js";
import { UpdateAccountProfileService } from "./commands/update-account-profile/update-account-profile.service.js";
import { UpdateMyProfileHttpController } from "./commands/update-my-profile/update-my-profile.http.controller.js";
import { UpdateMyProfileService } from "./commands/update-my-profile/update-my-profile.service.js";
import { AccountRepository } from "./database/account.repository.js";
import { KeycloakIdentityProvider } from "./identity/keycloak-identity-provider.js";
import { GetMyAccountHttpController } from "./queries/get-my-account/get-my-account.http.controller.js";
import { GetMyAccountQueryHandler } from "./queries/get-my-account/get-my-account.query-handler.js";
import { ListAccountsHttpController } from "./queries/list-accounts/list-accounts.http.controller.js";
import { ListAccountsQueryHandler } from "./queries/list-accounts/list-accounts.query-handler.js";

@Module({
  controllers: [
    GetMyAccountHttpController,
    ListAccountsHttpController,
    ChangeAccountRoleHttpController,
    // `accounts/me/profile` must come before `accounts/:accountId/profile`, or "me" is taken for an id.
    UpdateMyProfileHttpController,
    UpdateAccountProfileHttpController,
  ],
  providers: [
    { provide: ACCOUNT_REPOSITORY, useClass: AccountRepository },
    { provide: IDENTITY_PROVIDER, useClass: KeycloakIdentityProvider },
    // Every controller in the application passes through it, not only this module's.
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    GetMyAccountQueryHandler,
    ListAccountsQueryHandler,
    ChangeAccountRoleService,
    UpdateMyProfileService,
    UpdateAccountProfileService,
  ],
})
export class AccountModule {}
