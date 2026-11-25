import type { NestExpressApplication } from "@nestjs/platform-express";
import { inject } from "vitest";
import { createApp } from "../../src/app.js";
import { loadAppConfig } from "../../src/configs/app.config.js";
import { testAuthEnv } from "./keycloak.js";

export const testWebOrigin = "http://localhost:3000";

/**
 * The application as main.ts builds it, against the test database and Keycloak, with responses
 * validated. `overrides` replace environment variables, such as to give it a wrong secret or
 * another database.
 */
export async function startTestApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const app = await createApp(
    loadAppConfig({
      WEB_ORIGIN: testWebOrigin,
      VALIDATE_RESPONSES: "true",
      DATABASE_URL: inject("databaseUrl"),
      ...testAuthEnv(),
      ...overrides,
    }),
  );
  await app.init();
  return app;
}
