import "reflect-metadata";
import compression from "compression";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import * as OpenApiValidator from "express-openapi-validator";
import { AppModule } from "./app.module.js";
import type { AppConfig } from "./configs/app.config.js";
import { contractSpecPath } from "./libs/api/contract.js";
import { AccessTokenVerifier } from "./libs/auth/access-token-verifier.js";
import { bearerAuth } from "./libs/auth/bearer-auth.js";
import { ContractErrorFilter } from "./libs/api/contract-error.filter.js";

/** Builds the application. Shared by main.ts and the end-to-end tests so both run the same stack. */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  // The order below matters. NestJS registers its own body parser during initialization,
  // after anything added with app.use, so the validator would see no body. CORS must run
  // before the validator, or preflight requests get a 405.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { bodyParser: false });
  app.disable("x-powered-by");
  app.enableCors({ origin: config.webOrigins });
  // The region partition runs to several megabytes of GeoJSON, which compresses well.
  app.use(compression());
  // A save carries the full geometry of every region it changes, which can be large.
  app.use(express.json({ limit: "25mb" }));
  app.use(
    OpenApiValidator.middleware({
      apiSpec: contractSpecPath,
      validateRequests: true,
      validateResponses: config.validateResponses,
      validateSecurity: { handlers: { BearerAuth: bearerAuth(new AccessTokenVerifier(config.auth)) } },
    }),
  );
  app.useGlobalFilters(new ContractErrorFilter());
  return app;
}
