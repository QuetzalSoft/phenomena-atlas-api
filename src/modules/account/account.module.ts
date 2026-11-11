import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ACCOUNT_REPOSITORY } from "./account.di-tokens.js";
import { AuthorizationGuard } from "./authorization/authorization.guard.js";
import { ChangeAccountRoleHttpController } from "./commands/change-account-role/change-account-role.http.controller.js";
import { ChangeAccountRoleService } from "./commands/change-account-role/change-account-role.service.js";
import { AccountRepository } from "./database/account.repository.js";
import { GetMyAccountHttpController } from "./queries/get-my-account/get-my-account.http.controller.js";
import { GetMyAccountQueryHandler } from "./queries/get-my-account/get-my-account.query-handler.js";
import { ListAccountsHttpController } from "./queries/list-accounts/list-accounts.http.controller.js";
import { ListAccountsQueryHandler } from "./queries/list-accounts/list-accounts.query-handler.js";

@Module({
  controllers: [GetMyAccountHttpController, ListAccountsHttpController, ChangeAccountRoleHttpController],
  providers: [
    { provide: ACCOUNT_REPOSITORY, useClass: AccountRepository },
    // Every controller in the application passes through it, not only this module's.
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    GetMyAccountQueryHandler,
    ListAccountsQueryHandler,
    ChangeAccountRoleService,
  ],
})
export class AccountModule {}
