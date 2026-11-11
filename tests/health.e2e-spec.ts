import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, testWebOrigin as webOrigin } from "./support/app.js";

describe("health", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports the service is running", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);

    expect(response.body).toEqual({ status: "ok" });
  });

  it("does not need an access token, even with a bad one", async () => {
    await request(app.getHttpServer()).get("/health").set("Authorization", "Bearer not-a-token").expect(200);
  });

  it("lets the web client call it from the browser", async () => {
    const response = await request(app.getHttpServer())
      .options("/health")
      .set("Origin", webOrigin)
      .set("Access-Control-Request-Method", "GET")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe(webOrigin);
  });

  it("does not let other origins call it from the browser", async () => {
    const response = await request(app.getHttpServer())
      .get("/health")
      .set("Origin", "https://evil.example")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a route the contract does not declare with a contract error", async () => {
    const response = await request(app.getHttpServer()).get("/nope").expect(404);

    const body = response.body as Record<string, unknown>;
    expect(body.code).toBe("not_found");
    expect(typeof body.message).toBe("string");
  });

  it("answers a method the contract does not declare with a contract error and Allow", async () => {
    const response = await request(app.getHttpServer()).delete("/health").expect(405);

    expect(response.body).toMatchObject({ code: "method_not_allowed" });
    expect(response.headers.allow).toContain("GET");
  });
});
