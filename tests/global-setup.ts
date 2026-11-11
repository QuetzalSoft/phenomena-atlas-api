import { readFile } from "node:fs/promises";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { createDatabase } from "../src/libs/db/database.js";
import { createMigrator, throwIfFailed } from "../src/libs/db/migrator.js";
import { otherAudienceClientId, realm, testClientId } from "./support/keycloak.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    /** Base URL of the test Keycloak, such as http://localhost:32768. */
    keycloakUrl: string;
  }
}

/** Starts one migrated PostGIS and one Keycloak for the whole run, on the images compose.yaml uses. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Under Bun, Testcontainers never sees the database become ready and Vitest exits 0
  // without running a test. Fail loudly instead of passing silently.
  if (process.versions.bun) {
    throw new Error("The tests need Node.js (see .node-version). `bun run` falls back to Bun when node is not installed.");
  }

  const [database, keycloak] = await Promise.all([startDatabase(), startKeycloak()]);

  project.provide("databaseUrl", database.getConnectionUri());
  project.provide("keycloakUrl", `http://${keycloak.getHost()}:${keycloak.getMappedPort(8080)}`);
  return async () => {
    await Promise.all([database.stop(), keycloak.stop()]);
  };
}

async function startDatabase() {
  const container = await new PostgreSqlContainer("postgis/postgis:18-3.6")
    // PostGIS only publishes amd64 images. On Apple silicon Docker runs this one emulated.
    .withPlatform("linux/amd64")
    // Hides the image's init scripts, which install PostGIS and other extensions in the
    // database on their own. A managed database does not, so the migrations must.
    .withTmpFs({ "/docker-entrypoint-initdb.d": "rw" })
    .start();

  const db = createDatabase(container.getConnectionUri());
  try {
    throwIfFailed(await createMigrator(db).migrateToLatest());
  } finally {
    await db.destroy();
  }
  return container;
}

async function startKeycloak(): Promise<StartedTestContainer> {
  const realmFile = new URL("../keycloak/phenomena-atlas-realm.json", import.meta.url);
  const testRealm = withTestClients(JSON.parse(await readFile(realmFile, "utf8")) as RealmFile);

  return new GenericContainer("quay.io/keycloak/keycloak:26.8.1")
    .withCommand(["start-dev", "--import-realm"])
    .withCopyContentToContainer([
      { content: JSON.stringify(testRealm), target: `/opt/keycloak/data/import/${realm}-realm.json` },
    ])
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp(`/realms/${realm}`, 8080).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
}

interface RealmClient {
  clientId: string;
  directAccessGrantsEnabled?: boolean;
  protocolMappers?: unknown[];
  [key: string]: unknown;
}

interface RealmFile {
  clients: RealmClient[];
  [key: string]: unknown;
}

// Copies of the real web client, so the tokens tests get carry exactly what the web gets.
// They allow logging in with a password, which the real client must not.
function withTestClients(realmFile: RealmFile): RealmFile {
  const web = realmFile.clients.find((client) => client.clientId === "phenomena-atlas-web");
  if (!web) {
    throw new Error("The realm file has no phenomena-atlas-web client.");
  }
  return {
    ...realmFile,
    clients: [
      ...realmFile.clients,
      { ...web, clientId: testClientId, directAccessGrantsEnabled: true },
      { ...web, clientId: otherAudienceClientId, directAccessGrantsEnabled: true, protocolMappers: [] },
    ],
  };
}
