export interface AppConfig {
  port: number;
  /** Origins allowed by CORS: the web client, and any other browser client. */
  webOrigins: string[];
  /** Validate responses against the contract. On in tests, off in production. */
  validateResponses: boolean;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8000),
    webOrigins: (env.WEB_ORIGIN ?? "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    validateResponses: env.VALIDATE_RESPONSES === "true",
  };
}
