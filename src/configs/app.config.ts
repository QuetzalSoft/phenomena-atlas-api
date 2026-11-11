import type { AccessTokenOptions } from "../libs/auth/access-token-verifier.js";

export interface AppConfig {
  port: number;
  /** Origins allowed by CORS: the web client, and any other browser client. */
  webOrigins: string[];
  /** Validate responses against the contract. On in tests, off in production. */
  validateResponses: boolean;
  /** PostgreSQL connection URL. Required, so a missing setting never points at the wrong database. */
  databaseUrl: string;
  /** Which access tokens to accept. Required, so a missing setting never weakens the check. */
  auth: AccessTokenOptions;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8000),
    webOrigins: (env.WEB_ORIGIN ?? "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    validateResponses: env.VALIDATE_RESPONSES === "true",
    databaseUrl: loadDatabaseUrl(env),
    auth: {
      issuer: required(env, "AUTH_ISSUER"),
      audience: required(env, "AUTH_AUDIENCE"),
      jwksUrl: required(env, "AUTH_JWKS_URL"),
    },
  };
}

/** The only setting the migrations need, so running them does not require the rest. */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return required(env, "DATABASE_URL");
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}
